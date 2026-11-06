import { beforeEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { DurableObjectState, WebSocket } from '@cloudflare/workers-types'
import { RealtimeRoom } from './room.server'
import { encodeFrames, FrameType, limits } from './protocol'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: DurableObjectState) {}
  },
}))
const metadata = new Map<string, unknown>()
let sockets: WebSocket[] = []
const storage = {
  get: vi.fn(async (key: string) => metadata.get(key)),
  put: vi.fn(async (key: string, value: unknown) => {
    metadata.set(key, value)
  }),
  list: vi.fn(async () => new Map(metadata)),
  delete: vi.fn(async (key: string) => metadata.delete(key)),
  transaction: vi.fn(),
  setAlarm: vi.fn(),
}
const state = Object.assign({} as DurableObjectState, {
  storage,
  getWebSockets: () => sockets,
})
function socket(readOnly = false, expiresAt = Date.now() + 60_000) {
  let attachment = {
    userId: 'user',
    accountId: 'account',
    readOnly,
    expiresAt,
    connectionId: 'connection',
    epoch: 1,
    windowStart: Date.now(),
    messages: 0,
    bytes: 0,
    pending: [] as number[],
  }
  return Object.assign({} as WebSocket, {
    deserializeAttachment: () => attachment,
    serializeAttachment: (next: typeof attachment) => {
      attachment = next
    },
    send: vi.fn(),
    close: vi.fn(),
  })
}
function message(
  room: RealtimeRoom,
  source: WebSocket,
  type: FrameType,
  payload: Uint8Array,
) {
  for (const frame of encodeFrames(type, payload))
    room.webSocketMessage(source, new Uint8Array(frame).buffer)
}
beforeEach(() => {
  vi.clearAllMocks()
  metadata.clear()
  sockets = []
  storage.transaction.mockImplementation(
    (callback: (value: typeof storage) => Promise<number>) => callback(storage),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

it('denies viewer mutation frames including forged sync replies and chunks', () => {
  const room = new RealtimeRoom(state, {} as Cloudflare.Env)
  const viewer = socket(true)
  const recipient = socket()
  sockets = [viewer, recipient]
  message(
    room,
    viewer,
    FrameType.SyncUpdate,
    Y.encodeStateAsUpdate(new Y.Doc()),
  )
  expect(viewer.close).toHaveBeenCalledWith(4002, expect.any(String))
  expect(recipient.send).not.toHaveBeenCalled()
  const update = new Uint8Array(limits.maxFrameBytes + 1)
  message(room, viewer, FrameType.Update, update)
  expect(recipient.send).not.toHaveBeenCalled()
})

it('checks both sender and recipient expiry and rejects malformed updates', () => {
  const room = new RealtimeRoom(state, {} as Cloudflare.Env)
  const source = socket()
  const expired = socket(false, Date.now() - 1)
  const valid = socket()
  sockets = [source, expired, valid]
  message(room, source, FrameType.Update, Y.encodeStateAsUpdate(new Y.Doc()))
  expect(expired.send).not.toHaveBeenCalled()
  expect(expired.close).toHaveBeenCalledWith(4001, expect.any(String))
  expect(valid.send).toHaveBeenCalledTimes(1)
  message(room, source, FrameType.Update, new Uint8Array([255]))
  expect(source.close).toHaveBeenCalledWith(4002, expect.any(String))
})

it('rejects late authorizations and invalidates queued messages after revocation', async () => {
  const room = new RealtimeRoom(state, {} as Cloudflare.Env)
  const source = socket()
  const target = socket()
  sockets = [source, target]
  const first = await room.beginAuthorization('user')
  const second = await room.beginAuthorization('user')
  expect(await room.finishAuthorization('user', second, null)).toBe(true)
  expect(
    await room.finishAuthorization('user', first, {
      userId: 'user',
      accountId: 'account',
      readOnly: false,
      expiresAt: Date.now() + 60_000,
    }),
  ).toBe(false)
  message(room, source, FrameType.Update, Y.encodeStateAsUpdate(new Y.Doc()))
  expect(target.send).not.toHaveBeenCalled()
  expect(source.deserializeAttachment().expiresAt).toBe(0)
  expect(
    [...metadata.values()].every(
      (value) => !JSON.stringify(value).includes('payload'),
    ),
  ).toBe(true)
})

it('bounds unacknowledged output and accepts bounded acknowledgments', () => {
  const room = new RealtimeRoom(state, {} as Cloudflare.Env)
  const source = socket()
  const target = socket()
  sockets = [source, target]
  const attachment = target.deserializeAttachment()
  attachment.pending = [limits.maxQueuedBytes]
  target.serializeAttachment(attachment)
  message(room, source, FrameType.Update, Y.encodeStateAsUpdate(new Y.Doc()))
  message(room, target, FrameType.Ack, new Uint8Array())
  expect(target.deserializeAttachment().pending.length).toBeLessThanOrEqual(1)
  attachment.pending = [limits.maxQueuedBytes + 1024]
  target.serializeAttachment(attachment)
  message(room, source, FrameType.Update, Y.encodeStateAsUpdate(new Y.Doc()))
  expect(target.close).toHaveBeenCalledWith(4002, 'Slow recipient')
})

it('enforces per-user rates across sockets and expires grants after room reconstruction', async () => {
  const first = socket()
  const second = socket()
  const third = socket()
  sockets = [first, second, third]
  const room = new RealtimeRoom(state, {} as Cloudflare.Env)
  for (let index = 0; index < 512; index++) {
    message(room, first, FrameType.Publication, new Uint8Array())
    message(room, second, FrameType.Publication, new Uint8Array())
  }
  message(room, third, FrameType.Publication, new Uint8Array())
  expect(third.close).toHaveBeenCalledWith(
    4002,
    'Invalid or excessive realtime traffic',
  )
  for (const peer of sockets) {
    const attachment = peer.deserializeAttachment()
    peer.serializeAttachment({ ...attachment, expiresAt: Date.now() - 1 })
  }
  const reconstructed = new RealtimeRoom(state, {} as Cloudflare.Env)
  await reconstructed.alarm()
  for (const peer of sockets)
    expect(peer.close).toHaveBeenCalledWith(4001, 'Authorization expired')
})
