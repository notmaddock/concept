import { afterEach, describe, expect, it, vi } from 'vitest'
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness'
import { RealtimeClient } from './client'
import {
  FrameType,
  UpdateAssembler,
  decodeFrame,
  encodeFrames,
  limits,
} from './protocol'
import { realtimeConfig } from './config'

class Socket {
  static OPEN = 1
  static instances: Array<Socket> = []
  readyState = 1
  bufferedAmount = 0
  binaryType = ''
  sent: Array<Uint8Array> = []
  onopen?: () => void
  onmessage?: (event: MessageEvent) => void
  onclose?: () => void
  onerror?: () => void
  constructor() {
    Socket.instances.push(this)
  }
  send(bytes: ArrayBuffer) {
    this.sent.push(new Uint8Array(bytes))
  }
  close() {
    this.readyState = 3
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Socket.instances = []
})

async function setup(canWrite = () => true, accountId?: string) {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', {
    origin: 'https://concept.test',
    protocol: 'https:',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ readOnly: false, expiresAt: Date.now() + 60_000 }),
    }),
  )
  const doc = new Doc()
  const client = new RealtimeClient({
    doc,
    fileId: 'file',
    accountId,
    canWrite,
    onAccess: vi.fn(),
    onPublication: vi.fn(),
  })
  client.start()
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.instances.at(0)
  socket?.onopen?.()
  if (socket) socket.sent = []
  return { client, doc, socket: socket! }
}

describe('realtime batching', () => {
  it('refuses a room grant from a different linked account', async () => {
    const { client, doc } = await setup(() => true, 'expected-account')
    expect(Socket.instances).toHaveLength(0)
    client.stop()
    doc.destroy()
  })
  it('flushes continuous typing on the first deadline, merges updates, and sends nothing while idle', async () => {
    const { client, doc, socket } = await setup()
    doc.getText('text').insert(0, 'a')
    await vi.advanceTimersByTimeAsync(60)
    doc.getText('text').insert(1, 'b')
    await vi.advanceTimersByTimeAsync(40)
    expect(socket.sent).toHaveLength(1)
    const remote = new Doc()
    applyUpdate(remote, decodeFrame(socket.sent[0]).payload)
    expect(remote.getText('text').toString()).toBe('ab')
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.sent).toHaveLength(1)
    client.stop()
    doc.destroy()
    remote.destroy()
  })

  it('drops pending mutations on write loss and reconciles rather than replaying on reconnect', async () => {
    let writable = true
    const { client, doc, socket } = await setup(() => writable)
    doc.getText('text').insert(0, 'private')
    writable = false
    await vi.advanceTimersByTimeAsync(100)
    expect(socket.sent).toHaveLength(0)
    expect(doc.getText('text').toString()).toBe('private')
    client.stop()
    doc.destroy()
  })

  it('stops on backpressure while preserving the local document', async () => {
    const { client, doc, socket } = await setup()
    socket.bufferedAmount = limits.maxQueuedBytes
    doc.getText('text').insert(0, 'safe locally')
    await vi.advanceTimersByTimeAsync(100)
    expect(socket.readyState).toBe(3)
    expect(doc.getText('text').toString()).toBe('safe locally')
    client.stop()
    doc.destroy()
  })

  it('persists remote mutations through the document event without echoing them', async () => {
    const { client, doc, socket } = await setup()
    const author = new Doc()
    author.getText('text').insert(0, 'remote')
    const changed = vi.fn()
    doc.on('update', changed)
    const frame = encodeFrames(FrameType.Update, encodeStateAsUpdate(author))[0]
    socket.onmessage?.({ data: new Uint8Array(frame).buffer } as MessageEvent)
    await vi.advanceTimersByTimeAsync(100)
    expect(doc.getText('text').toString()).toBe('remote')
    expect(changed).toHaveBeenCalledOnce()
    expect(socket.sent.map((bytes) => decodeFrame(bytes).type)).toEqual([
      FrameType.Ack,
    ])
    client.stop()
    doc.destroy()
    author.destroy()
  })

  it('coalesces presence separately and retains only the latest state', async () => {
    const { client, doc, socket } = await setup()
    const awareness = new Awareness(doc)
    client.attachAwareness(awareness)
    awareness.setLocalState({ name: 'first' })
    await vi.advanceTimersByTimeAsync(60)
    awareness.setLocalState({ name: 'latest' })
    await vi.advanceTimersByTimeAsync(40)
    expect(socket.sent).toHaveLength(1)
    const frame = decodeFrame(socket.sent[0])
    expect(frame.type).toBe(FrameType.Presence)
    const remoteDoc = new Doc()
    const remote = new Awareness(remoteDoc)
    applyAwarenessUpdate(remote, frame.payload, null)
    expect(remote.getStates().get(doc.clientID)).toEqual({ name: 'latest' })
    client.stop()
    awareness.destroy()
    remote.destroy()
    doc.destroy()
    remoteDoc.destroy()
  })

  it('discards queued frames after disconnect and begins reconnection with fresh access and a state vector', async () => {
    const { client, doc, socket } = await setup()
    doc.getText('text').insert(0, 'offline work')
    socket.readyState = 3
    socket.onclose?.()
    await vi.advanceTimersByTimeAsync(5000)
    const reconnected = Socket.instances[1]
    reconnected.onopen?.()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(reconnected.sent.map((bytes) => decodeFrame(bytes).type)).toEqual([
      FrameType.StateVector,
    ])
    expect(doc.getText('text').toString()).toBe('offline work')
    client.stop()
    doc.destroy()
  })
})

it('validates deployment periods', () => {
  for (const updatePeriodMs of [NaN, Infinity, 0, 15, 5001, 100.5])
    expect(() => realtimeConfig({ updatePeriodMs })).toThrow()
  expect(realtimeConfig().updatePeriodMs).toBe(100)
})

it('splits bounded updates and rejects malformed or reordered chunks', () => {
  const doc = new Doc()
  doc.getText('text').insert(0, 'x'.repeat(150_000))
  const update = encodeStateAsUpdate(doc)
  const frames = encodeFrames(FrameType.Update, update, 12)
  expect(frames.every((frame) => frame.length <= limits.maxFrameBytes)).toBe(
    true,
  )
  const assembler = new UpdateAssembler()
  let completed
  for (const frame of frames) completed = assembler.push(decodeFrame(frame))
  expect(completed?.payload).toEqual(update)
  expect(() => new UpdateAssembler().push(decodeFrame(frames[1]))).toThrow()
  expect(() =>
    encodeFrames(FrameType.Update, new Uint8Array(limits.maxUpdateBytes + 1)),
  ).toThrow()
  doc.destroy()
})
