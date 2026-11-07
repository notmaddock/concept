import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  Awareness,
} from 'y-protocols/awareness'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { writeUpdate } from 'y-protocols/sync'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { realtimePolicy } from './policy'
import {
  TicketRequestError,
  WebSocketRealtimeProvider,
} from './websocket-provider'
import type { DocumentCapabilities } from './capabilities'
import type { RealtimeHandle } from './realtime'
import type { RealtimeTicket, WebSocketLike } from './websocket-provider'

const handle = { storage: 'google-drive' as const, fileId: 'file-1' }

const editable: DocumentCapabilities = {
  view: true,
  edit: true,
  comment: false,
}
const viewOnly: DocumentCapabilities = {
  view: true,
  edit: false,
  comment: false,
}

class FakeSocket implements WebSocketLike {
  binaryType = 'blob'
  sent: (string | ArrayBuffer | Uint8Array)[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose:
    | ((event: { code?: number; reason?: string; wasClean?: boolean }) => void)
    | null = null
  onerror: ((event: unknown) => void) | null = null

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data)
  }

  close(code?: number) {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code, wasClean: true })
  }

  open() {
    this.onopen?.()
  }

  receive(data: string | Uint8Array) {
    this.onmessage?.({ data })
  }

  serverClose(code = 1006) {
    this.closed = true
    this.onclose?.({ code, wasClean: false })
  }
}

const updateFrame = (update: Uint8Array) => {
  const encoder = encoding.createEncoder()
  writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

const binaryFrames = (socket: FakeSocket) =>
  socket.sent.filter((data): data is Uint8Array => typeof data !== 'string')

const updateFrames = (socket: FakeSocket) =>
  binaryFrames(socket).filter((frame) => frame[0] === 2)

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

function setup(options?: {
  ticket?: RealtimeTicket
  fetchTicket?: (handle: RealtimeHandle) => Promise<RealtimeTicket>
}) {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const ticket: RealtimeTicket = options?.ticket ?? {
    ticket: 'ticket-1',
    expiresAt: Date.now() + realtimePolicy.ticketTtlMs,
    capabilities: editable,
  }
  const fetchTicket = options?.fetchTicket ?? vi.fn(async () => ticket)
  const createSocket = (url: string) => {
    urls.push(url)
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket
  }
  const provider = new WebSocketRealtimeProvider(handle, {
    fetchTicket,
    createSocket,
  })
  return { provider, sockets, urls, fetchTicket, ticket }
}

const admit = (
  socket: FakeSocket,
  capabilities: DocumentCapabilities = editable,
) => socket.receive(JSON.stringify({ type: 'admitted', capabilities }))

const providers: WebSocketRealtimeProvider[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const provider of providers.splice(0)) provider.close()
})

const tracked = (provider: WebSocketRealtimeProvider) => {
  providers.push(provider)
  return provider
}

describe('WebSocketRealtimeProvider', () => {
  it('sends hello on open, sync step1 + awareness on admitted, and applies incoming updates', async () => {
    const { provider, sockets } = setup()
    tracked(provider)
    const doc = new Doc()
    provider.attach(doc)
    provider.connect()
    await flush()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].sent).toHaveLength(0)
    const socket = sockets[0]
    socket.open()
    expect(socket.sent[0]).toBe(
      JSON.stringify({ type: 'hello', protocol: 1, ticket: 'ticket-1' }),
    )
    admit(socket)
    expect(provider.getState().status).toBe('connected')
    expect(provider.getState().capabilities).toEqual(editable)
    const frames = binaryFrames(socket)
    expect(frames.some((frame) => frame[0] === 0)).toBe(true) // sync step1
    expect(frames.some((frame) => frame[0] === 3)).toBe(true) // awareness
    const remote = new Doc()
    remote.getMap('metadata').set('name', 'from-remote')
    socket.receive(updateFrame(encodeStateAsUpdate(remote)))
    expect(doc.getMap('metadata').get('name')).toBe('from-remote')
  })

  it('batches local doc updates into one merged update frame after updateIntervalMs', async () => {
    vi.useFakeTimers()
    const { provider, sockets } = setup()
    tracked(provider)
    const doc = new Doc()
    provider.attach(doc)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(updateFrames(socket)).toHaveLength(0)
    doc.getMap('metadata').set('a', 1)
    doc.getMap('metadata').set('b', 2)
    expect(updateFrames(socket)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(realtimePolicy.updateIntervalMs)
    const frames = updateFrames(socket)
    expect(frames).toHaveLength(1)
    const decoder = decoding.createDecoder(frames[0])
    decoding.readVarUint(decoder) // message type
    const merged = new Doc()
    applyUpdate(merged, decoding.readVarUint8Array(decoder))
    expect(merged.getMap('metadata').get('a')).toBe(1)
    expect(merged.getMap('metadata').get('b')).toBe(2)
  })

  it('does not send update frames when capabilities are view-only', async () => {
    vi.useFakeTimers()
    const { provider, sockets } = setup()
    tracked(provider)
    const doc = new Doc()
    provider.attach(doc)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket, viewOnly)
    doc.getMap('metadata').set('x', 1)
    await vi.advanceTimersByTimeAsync(realtimePolicy.updateIntervalMs * 4)
    expect(updateFrames(socket)).toHaveLength(0)
  })

  it('sets status revoked on revoked message and stops updates and reconnects', async () => {
    vi.useFakeTimers()
    const { provider, sockets } = setup()
    tracked(provider)
    let notified = 0
    provider.subscribe(() => notified++)
    const doc = new Doc()
    provider.attach(doc)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    socket.receive(JSON.stringify({ type: 'revoked', capabilities: viewOnly }))
    expect(provider.getState().status).toBe('revoked')
    expect(provider.getState().capabilities).toEqual(viewOnly)
    expect(notified).toBeGreaterThan(0)
    doc.getMap('metadata').set('x', 1)
    await vi.advanceTimersByTimeAsync(realtimePolicy.updateIntervalMs * 4)
    expect(updateFrames(socket)).toHaveLength(0)
    socket.serverClose(4403)
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectMaxMs * 2)
    expect(sockets).toHaveLength(1)
  })

  it('reconnects with backoff and reuses the cached ticket while unexpired', async () => {
    vi.useFakeTimers()
    const { provider, sockets, urls, fetchTicket } = setup()
    tracked(provider)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
    socket.serverClose()
    expect(provider.getState().status).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectBaseMs)
    expect(sockets).toHaveLength(2)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
    expect(urls[1]).toContain(`fileId=${handle.fileId}`)
    expect(urls[1]).toContain('ticket=ticket-1')
    sockets[1].open()
    admit(sockets[1])
    expect(provider.getState().status).toBe('connected')
  })

  it('fails silently to disconnected when the ticket fetch fails', async () => {
    const fetchTicket = vi.fn(async () => {
      throw new Error('ticket endpoint down')
    })
    const { provider, sockets } = setup({ fetchTicket })
    tracked(provider)
    provider.connect()
    await flush()
    expect(provider.getState().status).toBe('disconnected')
    expect(sockets).toHaveLength(0)
  })

  it('stops retrying when the ticket endpoint refuses permanently', async () => {
    vi.useFakeTimers()
    const fetchTicket = vi.fn(async () => {
      throw new TicketRequestError(403, 'no drive access')
    })
    const { provider, sockets } = setup({ fetchTicket })
    tracked(provider)
    provider.connect()
    await flush()
    expect(provider.getState().status).toBe('disconnected')
    expect(sockets).toHaveLength(0)
    expect(fetchTicket).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectMaxMs * 3)
    expect(sockets).toHaveLength(0)
    expect(fetchTicket).toHaveBeenCalledOnce()
  })

  it('keeps retrying when the ticket endpoint fails transiently', async () => {
    vi.useFakeTimers()
    const fetchTicket = vi.fn(async () => {
      throw new Error('down')
    })
    const { provider, sockets } = setup({ fetchTicket })
    tracked(provider)
    provider.connect()
    await flush()
    expect(provider.getState().status).toBe('disconnected')
    expect(sockets).toHaveLength(0)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectBaseMs)
    expect(fetchTicket.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(sockets).toHaveLength(0)
  })

  it('keeps retrying when the ticket endpoint fails with a server error', async () => {
    vi.useFakeTimers()
    const fetchTicket = vi.fn(async () => {
      throw new TicketRequestError(500, 'server error')
    })
    const { provider, sockets } = setup({ fetchTicket })
    tracked(provider)
    provider.connect()
    await flush()
    expect(provider.getState().status).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectBaseMs)
    expect(fetchTicket.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(sockets).toHaveLength(0)
  })

  it('refetches the ticket after a 4401 close instead of reusing the expired one', async () => {
    vi.useFakeTimers()
    const { provider, sockets, fetchTicket } = setup()
    tracked(provider)
    provider.connect()
    await flush()
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(provider.getState().status).toBe('connected')
    expect(fetchTicket).toHaveBeenCalledTimes(1)

    socket.serverClose(4401)
    expect(provider.getState().status).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectMaxMs * 3)
    expect(sockets).toHaveLength(1)

    provider.connect()
    await flush()
    expect(fetchTicket).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    admit(sockets[1])
    expect(provider.getState().status).toBe('connected')
  })

  it('does not retry after a 4403 close', async () => {
    vi.useFakeTimers()
    const { provider, sockets, fetchTicket } = setup()
    tracked(provider)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(provider.getState().status).toBe('connected')

    socket.serverClose(4403)
    expect(provider.getState().status).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(realtimePolicy.reconnectMaxMs * 3)
    expect(sockets).toHaveLength(1)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
  })

  it('disconnects on demand and reconnects with a fresh socket', async () => {
    const { provider, sockets } = setup()
    tracked(provider)
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(provider.getState().status).toBe('connected')

    provider.disconnect()
    expect(socket.closed).toBe(true)
    expect(provider.getState().status).toBe('disconnected')
    expect(provider.getState().capabilities).toEqual(editable)
    expect(provider.awareness.getStates().size).toBe(0)
    expect(provider.getState().collaborators).toEqual([])

    provider.connect()
    await flush()
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    admit(sockets[1])
    expect(provider.getState().status).toBe('connected')
  })

  it('does not open a socket when disconnected during the ticket fetch', async () => {
    let resolveTicket!: (ticket: RealtimeTicket) => void
    const fetchTicket = vi.fn(
      () =>
        new Promise<RealtimeTicket>((resolve) => {
          resolveTicket = resolve
        }),
    )
    const { provider, sockets } = setup({ fetchTicket })
    tracked(provider)
    provider.connect()
    await flush()
    expect(fetchTicket).toHaveBeenCalledOnce()

    provider.disconnect()
    resolveTicket({
      ticket: 'ticket-1',
      expiresAt: Date.now() + realtimePolicy.ticketTtlMs,
      capabilities: editable,
    })
    await flush()
    expect(sockets).toHaveLength(0)
    expect(provider.getState().status).toBe('disconnected')
  })

  it('publishes a local presence state on admitted and counts remote peers', async () => {
    const { provider, sockets } = setup()
    tracked(provider)
    provider.attach(new Doc())
    provider.connect()
    await flush()
    const socket = sockets[0]
    socket.open()
    admit(socket)
    expect(provider.awareness.getLocalState()).not.toBeNull()
    // The outgoing awareness frame carries the local state, not a removal.
    const awarenessFrame = binaryFrames(socket).find((frame) => frame[0] === 3)
    expect(awarenessFrame).toBeDefined()
    const decoder = decoding.createDecoder(awarenessFrame!)
    decoding.readVarUint(decoder)
    const update = decoding.readVarUint8Array(decoder)
    const remote = new Awareness(new Doc())
    applyAwarenessUpdate(remote, update, 'test')
    expect(remote.getStates().get(provider.awareness.clientID)).not.toBeNull()

    expect(provider.getState().peers).toBe(0)
    expect(provider.getState().collaborators).toMatchObject([
      {
        clientID: provider.awareness.clientID,
        self: true,
        focusing: false,
      },
    ])
    const peerAwareness = new Awareness(new Doc())
    peerAwareness.setLocalState({
      presence: true,
      name: 'Ada',
      color: 'rgb(1, 2, 3)',
      focusing: true,
      awarenessData: { avatar: 'https://example.com/ada.png' },
    })
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 3)
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID]),
    )
    socket.receive(encoding.toUint8Array(encoder))
    expect(provider.getState().peers).toBe(1)
    expect(provider.getState().collaborators).toContainEqual({
      clientID: peerAwareness.clientID,
      self: false,
      name: 'Ada',
      color: 'rgb(1, 2, 3)',
      avatar: 'https://example.com/ada.png',
      focusing: true,
    })
  })
})
