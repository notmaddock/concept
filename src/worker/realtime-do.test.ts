import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentRealtimeDO } from './realtime-do'
import { signRealtimeTicket } from '#/lib/documents/realtime/ticket'
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
  let alarm: number | null = null
  const state = {
    id: { name: fileId, toString: () => fileId },
    storage: {
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => {
        alarm = at
      },
      deleteAlarm: async () => {
        alarm = null
      },
    },
    acceptWebSocket: (ws: FakeWebSocket) => {
      sockets.add(ws)
    },
    getWebSockets: () => [...sockets],
  }
  return {
    state,
    sockets,
    alarmAt: () => alarm,
    detach: (ws: FakeWebSocket) => sockets.delete(ws),
  }
}

class FakeWebSocket {
  private attachment: unknown = null
  sent: Array<string | Uint8Array> = []
  closed?: { code?: number; reason?: string }
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  serializeAttachment(value: unknown) {
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

    await doInstance.alarm()
    // Re-arming here would keep an empty room waking forever.
    expect(harness.alarmAt()).toBe(armed)
  })

  it('accepts the socket only after admission so no message is dropped', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    const attachedOnAccept: unknown[] = []
    const accept = harness.state.acceptWebSocket
    harness.state.acceptWebSocket = (ws: FakeWebSocket) => {
      // Messages can be delivered as soon as the socket is attached, so the
      // attachment must already be in place at this point.
      attachedOnAccept.push(ws.deserializeAttachment())
      accept(ws)
    }
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    expect(attachedOnAccept).toHaveLength(1)
    expect(attachedOnAccept[0]).toMatchObject({ userId: 'u1' })
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
