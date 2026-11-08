import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { readSyncStep2, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { env } from 'cloudflare:workers'
import { DocumentRealtimeDO } from './realtime-do'
import { signRealtimeTicket } from '#/lib/documents/realtime/ticket'
import { encodeControlMessage } from '#/lib/documents/realtime/protocol'
import { realtimePolicy } from '#/lib/documents/realtime/policy'
import type { DocumentCapabilities } from '#/lib/documents/realtime/capabilities'
import { handleGet } from '#/routes/api/realtime/$'
// The DO builds its Drive verifier from env; admission revalidates through it,
// so stub the module rather than reaching for D1 in a unit test. The verdict is
// configurable per test so a revalidation pass can downgrade or revoke a user.
const { verifyState, verifyCalls } = vi.hoisted(() => {
  type Verdict = { view: boolean; edit: boolean; comment: boolean }
  const state: { result: Verdict | undefined } = {
    result: { view: true, edit: true, comment: false },
  }
  const calls: Array<{ fileId: string; userId: string }> = []
  return { verifyState: state, verifyCalls: calls }
})

vi.mock('#/lib/documents/realtime/drive.server', () => ({
  createDriveVerifier: () => ({
    verify: async (fileId: string, userId: string) => {
      verifyCalls.push({ fileId, userId })
      return verifyState.result
    },
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
  readyState = 1
  send(data: string | Uint8Array) {
    // The runtime rejects sends on a socket that was not accepted first.
    if (!this.accepted)
      throw new TypeError(
        'You must call one of accept() or state.acceptWebSocket() on this WebSocket before sending messages.',
      )
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
    this.readyState = 3
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

/** A real Yjs update frame, so the room's applyUpdate cannot swallow it. */
function updateFrame(): ArrayBuffer {
  const doc = new Doc()
  doc.get('content', XmlText).insert(0, 'hello')
  const encoder = encoding.createEncoder()
  writeUpdate(encoder, encodeStateAsUpdate(doc))
  doc.destroy()
  const frame = encoding.toUint8Array(encoder)
  return frame.buffer.slice(
    frame.byteOffset,
    frame.byteOffset + frame.byteLength,
  )
}

function syncStep1Frame(): ArrayBuffer {
  const doc = new Doc()
  const encoder = encoding.createEncoder()
  writeSyncStep1(encoder, doc)
  doc.destroy()
  const frame = encoding.toUint8Array(encoder)
  return frame.buffer.slice(
    frame.byteOffset,
    frame.byteOffset + frame.byteLength,
  )
}

function awarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 3) // messageAwareness
  encoding.writeVarUint(encoder, 1) // 1 update
  encoding.writeVarUint(encoder, 42) // client id
  encoding.writeVarUint(encoder, 1) // clock
  encoding.writeVarString(encoder, '{"user":{"name":"Alice"}}')
  const frame = encoding.toUint8Array(encoder)
  return frame.buffer.slice(
    frame.byteOffset,
    frame.byteOffset + frame.byteLength,
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

  it('does not arm or attach a socket whose ticket was rejected', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest('v1.bad.bad'))
    const [socket] = harness.sockets
    // The socket is accepted so admit() can send its rejection, but it must
    // carry no attachment and must not keep the room awake.
    expect(socket.deserializeAttachment()).toBeNull()
    expect(harness.alarmAt()).toBeNull()
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

describe('DocumentRealtimeDO relay after hibernation', () => {
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

  it('relays a frame to peers that were attached before the wake-up', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    const [socketA, socketB] = [...harness.sockets]
    socketA.sent = []
    socketB.sent = []

    // Hibernation discards the room's in-memory client map while the runtime
    // keeps both sockets attached, so the woken object must rebuild every
    // client from its attachment before it can relay to anyone but the sender.
    const woken = createDo(harness)
    const frame = updateFrame()
    await woken.webSocketMessage(socketB as never, frame)

    // The peer receives the sender's exact frame, and the sender is not echoed.
    expect(socketA.sent).toHaveLength(1)
    expect(socketA.sent[0]).toEqual(new Uint8Array(frame))
    expect(socketB.sent).toHaveLength(0)
  })
})

describe('DocumentRealtimeDO capability persistence', () => {
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
    verifyState.result = editorCaps
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    verifyState.result = editorCaps
  })

  it('persists a downgrade so a wake-up does not restore edit rights', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets
    expect(socket.deserializeAttachment()).toMatchObject({
      capabilities: editorCaps,
    })

    verifyState.result = { view: true, edit: false, comment: false }
    // Advance past verdictCacheTtlMs to simulate the alarm firing at its scheduled time.
    vi.setSystemTime(Date.now() + realtimePolicy.revalidationIntervalMs)
    await harness.runAlarm(doInstance)

    expect(socket.deserializeAttachment()).toMatchObject({
      capabilities: { view: true, edit: false, comment: false },
    })

    // Hibernation discards the room; the woken object rebuilds from the
    // attachment, which must no longer carry edit rights.
    socket.sent = []
    const woken = createDo(harness)
    await woken.webSocketMessage(socket as never, updateFrame())

    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]).toBe(
      encodeControlMessage({
        type: 'error',
        message: 'Edit permission is required to send document updates.',
      }),
    )
  })

  it('persists a revocation so a wake-up does not restore view access', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets

    verifyState.result = undefined
    // Advance past verdictCacheTtlMs to simulate the alarm firing at its scheduled time.
    vi.setSystemTime(Date.now() + realtimePolicy.revalidationIntervalMs)
    await harness.runAlarm(doInstance)

    expect(socket.deserializeAttachment()).toMatchObject({
      capabilities: { view: false, edit: false, comment: false },
    })
    expect(socket.closed).toEqual({ code: 4403, reason: 'access revoked' })
  })

  it('does not rewrite the attachment when capabilities are unchanged', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets

    const serialize = vi.spyOn(socket, 'serializeAttachment')
    await harness.runAlarm(doInstance)

    // Revalidation runs every minute; an unchanged verdict must not cost a
    // serialization per socket per pass.
    expect(serialize).not.toHaveBeenCalled()
    expect(socket.deserializeAttachment()).toMatchObject({
      capabilities: editorCaps,
    })
  })
})

describe('DocumentRealtimeDO diagnostics', () => {
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
    vi.restoreAllMocks()
  })

  it('warns instead of silently dropping a frame for an unknown adapter', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets

    // A valid attachment whose adapter the room never restored: the frame has
    // nowhere to go, and the drop must be observable rather than presenting as
    // a stalled editor. Detaching removes it from getWebSockets, so the room
    // rebuilds without it while the sender still looks admitted.
    harness.detach(socket)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const woken = createDo(harness)
    await woken.webSocketMessage(socket as never, updateFrame())

    expect(warn).toHaveBeenCalledWith(
      '[realtime] frame for an unknown adapter; dropping',
    )
  })

  it('warns instead of silently skipping a socket with no attachment', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket] = harness.sockets
    socket.serializeAttachment(null)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const woken = createDo(harness)
    await harness.runAlarm(woken)

    expect(warn).toHaveBeenCalledWith(
      '[realtime] socket without a valid attachment; skipping',
    )
  })
})

describe('DocumentRealtimeDO resident room state preservation', () => {
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
    verifyCalls.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    verifyCalls.length = 0
  })

  it('preserves buffered updates across frames and catches up late joiners', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket1] = [...harness.sockets]

    // Client 1 sends a document update
    await doInstance.webSocketMessage(socket1 as never, updateFrame())

    // Client 2 connects
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    const sockets = [...harness.sockets]
    const socket2 = sockets[1]
    socket2.sent = []

    // Client 2 asks to sync step 1
    await doInstance.webSocketMessage(socket2 as never, syncStep1Frame())

    // Client 2 should receive SyncStep2 containing Client 1's buffered update
    expect(socket2.sent.length).toBeGreaterThanOrEqual(1)
    const step2Bytes = socket2.sent[0] as Uint8Array
    const decoder = decoding.createDecoder(step2Bytes)
    const messageType = decoding.readVarUint(decoder)
    expect(messageType).toBe(1) // messageYjsSyncStep2
    const targetDoc = new Doc()
    readSyncStep2(decoder, targetDoc, null)
    expect(targetDoc.get('content', XmlText).toString()).toContain('hello')
  })

  it('preserves awareness buffer across frames and sends to late joiners', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    const [socket1] = [...harness.sockets]

    // Client 1 sends awareness frame
    const awareness = awarenessFrame()
    await doInstance.webSocketMessage(socket1 as never, awareness)

    // Client 2 connects
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    const sockets = [...harness.sockets]
    const socket2 = sockets[1]
    socket2.sent = []

    // Client 2 asks to sync step 1
    await doInstance.webSocketMessage(socket2 as never, syncStep1Frame())

    // Client 2 receives awareness frame from Client 1
    expect(socket2.sent).toContainEqual(new Uint8Array(awareness))
  })

  it('preserves verdict cache within TTL so revalidations do not re-verify Drive', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    expect(verifyCalls.length).toBe(1)

    // Run alarm 5 seconds later (within 30s TTL)
    vi.setSystemTime(Date.now() + 5_000)
    await harness.runAlarm(doInstance)
    // Drive was not queried again because verdict cache was preserved
    expect(verifyCalls.length).toBe(1)

    // Advance past TTL
    vi.setSystemTime(Date.now() + realtimePolicy.verdictCacheTtlMs + 1_000)
    await harness.runAlarm(doInstance)
    // Drive was queried again after cache expiration
    expect(verifyCalls.length).toBe(2)
  })

  it('removes disconnected client from resident room and clears room when last client leaves', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    const [socket1, socket2] = [...harness.sockets]

    // Client 1 closes
    await doInstance.webSocketClose(socket1 as never)

    // Client 2 sends update; socket 1 should not receive it
    socket1.sent = []
    socket2.sent = []
    await doInstance.webSocketMessage(socket2 as never, updateFrame())
    expect(socket1.sent).toHaveLength(0)

    // Client 2 closes
    await doInstance.webSocketClose(socket2 as never)
    expect(harness.alarmAt()).toBeNull()
  })
})

describe('DocumentRealtimeDO disconnect alarm deletion', () => {
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

  it('deletes the alarm when the last client disconnects without manual detach', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    expect(harness.alarmAt()).not.toBeNull()

    const [socket] = harness.sockets
    // Do NOT call harness.detach - socket remains in getWebSockets during close
    await doInstance.webSocketClose(socket as never)
    expect(harness.alarmAt()).toBeNull()
  })

  it('keeps the alarm armed while another open client remains without manual detach', async () => {
    const harness = createState()
    const doInstance = createDo(harness)
    await doInstance.fetch(upgradeRequest(await ticketFor('u1', editorCaps)))
    await doInstance.fetch(upgradeRequest(await ticketFor('u2', editorCaps)))
    expect(harness.alarmAt()).not.toBeNull()

    const [socket1, socket2] = [...harness.sockets]
    await doInstance.webSocketClose(socket1 as never)
    expect(harness.alarmAt()).not.toBeNull()

    await doInstance.webSocketClose(socket2 as never)
    expect(harness.alarmAt()).toBeNull()
  })
})

describe('/api/realtime/socket route guards', () => {
  const mutableEnv = env as unknown as Record<string, unknown>

  beforeEach(() => {
    delete mutableEnv.REALTIME_ENABLED
    delete mutableEnv.REALTIME
  })

  it('returns 503 when REALTIME_ENABLED is false', async () => {
    mutableEnv.REALTIME_ENABLED = 'false'
    mutableEnv.REALTIME = {}
    const request = new Request(
      'http://localhost/api/realtime/socket?fileId=f1&ticket=t1',
      { headers: { Upgrade: 'websocket' } },
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({ error: 'Realtime collaboration is disabled.' })
  })

  it('returns 503 when env.REALTIME binding is unavailable', async () => {
    const request = new Request(
      'http://localhost/api/realtime/socket?fileId=f1&ticket=t1',
      { headers: { Upgrade: 'websocket' } },
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Realtime collaboration is unavailable on this deployment.',
    })
  })

  it('returns 400 when Upgrade header is not websocket', async () => {
    mutableEnv.REALTIME = {}
    const request = new Request(
      'http://localhost/api/realtime/socket?fileId=f1&ticket=t1',
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Expected a WebSocket upgrade request.')
  })

  it('returns 400 when fileId is missing', async () => {
    mutableEnv.REALTIME = {}
    const request = new Request(
      'http://localhost/api/realtime/socket?ticket=t1',
      { headers: { Upgrade: 'websocket' } },
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Missing fileId.')
  })

  it('returns 400 when ticket is missing', async () => {
    mutableEnv.REALTIME = {}
    const request = new Request(
      'http://localhost/api/realtime/socket?fileId=f1',
      { headers: { Upgrade: 'websocket' } },
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Missing ticket.')
  })

  it('forwards valid WebSocket request to Durable Object', async () => {
    const fetchMock = vi.fn(
      async () => ({ status: 101 }) as unknown as Response,
    )
    mutableEnv.REALTIME = {
      idFromName: vi.fn((name: string) => ({ toString: () => name })),
      get: vi.fn(() => ({ fetch: fetchMock })),
    }
    const request = new Request(
      'http://localhost/api/realtime/socket?fileId=f1&ticket=t1',
      { headers: { Upgrade: 'websocket' } },
    )
    const response = await handleGet({ request })
    expect(response.status).toBe(101)
    expect(fetchMock).toHaveBeenCalledWith(request)
  })
})
