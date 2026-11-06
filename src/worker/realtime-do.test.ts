import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentRealtimeDO } from './realtime-do'
import { signRealtimeTicket } from '#/lib/documents/realtime/ticket'
import { encodeControlMessage } from '#/lib/documents/realtime/protocol'
import { realtimePolicy } from '#/lib/documents/realtime/policy'
import type { DocumentCapabilities } from '#/lib/documents/realtime/capabilities'

// The DO builds its Drive verifier from env; admission revalidates through it,
// so stub the module rather than reaching for D1 in a unit test.
vi.mock('#/lib/documents/realtime/drive.server', () => ({
  createDriveVerifier: () => ({
    verify: async () => ({ view: true, edit: true, comment: false }),
  }),
}))

const fileId = 'file-1'
const secret = 'test-secret'

const editorCaps: DocumentCapabilities = {
  view: true,
  edit: true,
  comment: false,
}

/**
 * Minimal stand-in for the runtime pieces that decide hibernation: the set of
 * attached WebSockets and the single storage alarm. Timers are tracked so a
 * regression that reintroduces `setInterval` fails loudly.
 */
function createState() {
  const sockets = new Set<FakeWebSocket>()
  const values = new Map<string, unknown>()
  let alarm: number | null = null
  let alarmRunning = false
  const state = {
    id: { name: fileId, toString: () => fileId },
    storage: {
      // The runtime reports no alarm while the handler is running unless
      // setAlarm was called since it started, so mirror that here.
      getAlarm: async () => (alarmRunning ? null : alarm),
      setAlarm: async (at: number) => {
        alarm = at
      },
      deleteAlarm: async () => {
        alarm = null
      },
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => {
        values.set(key, value)
      },
    },
    acceptWebSocket: (ws: FakeWebSocket) => {
      ws.accepted = true
      sockets.add(ws)
    },
    getWebSockets: () => [...sockets],
  }
  return {
    state,
    sockets,
    values,
    alarmAt: () => alarm,
    detach: (ws: FakeWebSocket) => sockets.delete(ws),
    runAlarm: async (doInstance: DocumentRealtimeDO) => {
      alarmRunning = true
      try {
        await doInstance.alarm()
      } finally {
        alarmRunning = false
      }
    },
  }
}

class FakeWebSocket {
  private attachment: unknown = null
  accepted = false
  sent: Array<string | Uint8Array> = []
  closed?: { code?: number; reason?: string }
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  serializeAttachment(value: unknown) {
    // The runtime only allows attachments on an accepted socket; without this
    // guard the ordering bug that broke the preview deploy would pass here.
    if (!this.accepted)
      throw new TypeError(
        'serializeAttachment called on a WebSocket that was not accepted',
      )
    this.attachment = value
  }
  deserializeAttachment() {
    return this.attachment
  }
}

function createDo(harness: ReturnType<typeof createState>) {
  return new DocumentRealtimeDO(
    harness.state as unknown as ConstructorParameters<
      typeof DocumentRealtimeDO
    >[0],
    {
      BETTER_AUTH_SECRET: secret,
      OAUTH_PROXY_URL: 'https://concept.test',
    } as unknown as ConstructorParameters<typeof DocumentRealtimeDO>[1],
  )
}

async function ticketFor(userId: string, capabilities: DocumentCapabilities) {
  return signRealtimeTicket(
    { userId, fileId, capabilities, exp: Date.now() + 60_000 },
    secret,
  )
}

function upgradeRequest(ticket: string) {
  return new Request(
    `https://concept.test/socket?fileId=${fileId}&ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: 'websocket' } },
  )
}

describe('DocumentRealtimeDO hibernation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocketPair', function WebSocketPair() {
      return { 0: new FakeWebSocket(), 1: new FakeWebSocket() }
    })
    // Node's Response rejects the 101 upgrade status that Workers accepts.
    vi.stubGlobal(
      'Response',
      function Response(
        _body: unknown,
        init?: {
          status?: number
          webSocket?: unknown
        },
      ) {
        return { status: init?.status, webSocket: init?.webSocket }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('never schedules a timer that would block hibernation', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    // A pending interval is one of the conditions that keeps an object
    // resident and billing duration, so nothing may be left scheduled.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms a revalidation alarm only while a client is attached', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    expect(harness.alarmAt()).toBeNull()

    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    expect(harness.alarmAt()).not.toBeNull()

    const [socket] = harness.sockets
    harness.detach(socket)
    await doInstance.webSocketClose(socket as never)
    expect(harness.alarmAt()).toBeNull()
  })

  it('keeps the alarm armed while another client remains', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    const [first] = harness.sockets
    harness.detach(first)
    await doInstance.webSocketClose(first as never)
    expect(harness.alarmAt()).not.toBeNull()
  })

  it('does not arm an alarm for a rejected ticket', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest('v1.bad.bad'))
    expect(harness.alarmAt()).toBeNull()
  })

  it('does not push the alarm forward when no clients are attached', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets
    harness.detach(socket)
    const armed = harness.alarmAt()

    await harness.runAlarm(doInstance)
    // Re-arming here would keep an empty room waking forever.
    expect(harness.alarmAt()).toBe(armed)
  })

  it('buffers messages that arrive before the attachment is written', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    let earlyFrame: string | undefined
    const accept = harness.state.acceptWebSocket
    harness.state.acceptWebSocket = (ws: FakeWebSocket) => {
      accept(ws)
      // Simulate the runtime delivering a frame in the window between accept
      // and serializeAttachment, where no attachment exists yet.
      earlyFrame = encodeControlMessage({ type: 'publication' })
      void doInstance.webSocketMessage(ws as never, earlyFrame)
    }
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets
    // The frame is replayed once the attachment lands rather than dropped.
    expect(socket.deserializeAttachment()).toMatchObject({ userId: 'u1' })
    expect(harness.values.get('lastActiveAt')).toBeDefined()
  })

  it('does not attach a socket whose ticket was rejected', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest('v1.bad.bad'))
    expect(harness.sockets.size).toBe(0)
  })

  it('persists per-socket state so a woken object can relay without the handshake', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets
    expect(socket.deserializeAttachment()).toMatchObject({
      userId: 'u1',
      capabilities: editorCaps,
    })
  })
})

describe('DocumentRealtimeDO revalidation cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocketPair', function WebSocketPair() {
      return { 0: new FakeWebSocket(), 1: new FakeWebSocket() }
    })
    vi.stubGlobal(
      'Response',
      function Response(
        _body: unknown,
        init?: {
          status?: number
          webSocket?: unknown
        },
      ) {
        return { status: init?.status, webSocket: init?.webSocket }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('revalidates on the fast cadence right after a join', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    const now = Date.now()
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    expect(harness.alarmAt()).toBe(now + realtimePolicy.revalidationIntervalMs)
  })

  it('backs off once the room has been quiet past idleAfterMs', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))

    vi.setSystemTime(Date.now() + realtimePolicy.idleAfterMs + 1)
    await harness.runAlarm(doInstance)
    // A tab left open must not cost a Drive call every minute forever.
    expect(harness.alarmAt()).toBe(
      Date.now() + realtimePolicy.idleRevalidationIntervalMs,
    )
  })

  it('returns to the fast cadence when a save arrives', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    vi.setSystemTime(Date.now() + realtimePolicy.idleAfterMs + 1)
    await harness.runAlarm(doInstance)
    expect(harness.alarmAt()).toBe(
      Date.now() + realtimePolicy.idleRevalidationIntervalMs,
    )

    const [socket] = harness.sockets
    await doInstance.webSocketMessage(
      socket as never,
      encodeControlMessage({ type: 'publication' }),
    )
    expect(harness.alarmAt()).toBe(
      Date.now() + realtimePolicy.revalidationIntervalMs,
    )
  })

  it('ignores non-publication messages when tracking activity', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const armed = harness.alarmAt()
    const [socket] = harness.sockets
    await doInstance.webSocketMessage(
      socket as never,
      encodeControlMessage({ type: 'capabilities', capabilities: editorCaps }),
    )
    expect(harness.alarmAt()).toBe(armed)
  })
})
