import { decodeUpdate } from 'yjs'

export enum FrameType {
  StateVector = 0,
  SyncUpdate = 1,
  Update = 2,
  Presence = 3,
  Publication = 4,
  Chunk = 5,
  Ack = 6,
}

export const limits = {
  maxFrameBytes: 64 * 1024,
  maxUpdateBytes: 2 * 1024 * 1024,
  maxPresenceBytes: 4096,
  maxControlBytes: 4096,
  maxQueuedBytes: 2 * 1024 * 1024,
} as const

export interface Frame {
  type: FrameType
  payload: Uint8Array
}
export interface ChunkFrame extends Frame {
  type: FrameType.Chunk
  originalType: FrameType.Update | FrameType.SyncUpdate
  transferId: number
  index: number
  count: number
  total: number
}

export function decodeFrame(bytes: Uint8Array): Frame | ChunkFrame {
  if (
    !bytes.length ||
    bytes.length > limits.maxFrameBytes ||
    bytes[0] > FrameType.Ack
  )
    throw new Error('Invalid realtime frame.')
  const type = bytes[0]
  if (type === FrameType.Ack && bytes.length !== 1)
    throw new Error('Invalid realtime acknowledgement.')
  if (type !== FrameType.Chunk) {
    if (
      type !== FrameType.Update &&
      type !== FrameType.SyncUpdate &&
      bytes.length > limits.maxControlBytes
    )
      throw new Error('Realtime control frame is too large.')
    return { type, payload: bytes.slice(1) }
  }
  if (
    bytes.length <= 18 ||
    (bytes[1] !== FrameType.Update && bytes[1] !== FrameType.SyncUpdate)
  )
    throw new Error('Invalid realtime chunk.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frame: ChunkFrame = {
    type,
    originalType: bytes[1],
    transferId: view.getUint32(2),
    index: view.getUint32(6),
    count: view.getUint32(10),
    total: view.getUint32(14),
    payload: bytes.slice(18),
  }
  const expectedCount = Math.ceil(frame.total / (limits.maxFrameBytes - 18))
  if (
    !frame.total ||
    frame.total > limits.maxUpdateBytes ||
    frame.count !== expectedCount ||
    frame.index >= frame.count
  )
    throw new Error('Invalid realtime chunk bounds.')
  const expectedBytes = Math.min(
    limits.maxFrameBytes - 18,
    frame.total - frame.index * (limits.maxFrameBytes - 18),
  )
  if (frame.payload.length !== expectedBytes)
    throw new Error('Invalid realtime chunk length.')
  return frame
}

export function encodeFrames(
  type: FrameType,
  payload: Uint8Array,
  transferId = 0,
): Array<Uint8Array> {
  if (payload.length > limits.maxUpdateBytes)
    throw new Error('Realtime update is too large.')
  if (payload.length + 1 <= limits.maxFrameBytes) {
    const bytes = new Uint8Array(payload.length + 1)
    bytes[0] = type
    bytes.set(payload, 1)
    decodeFrame(bytes)
    return [bytes]
  }
  if (type !== FrameType.Update && type !== FrameType.SyncUpdate)
    throw new Error('Control frame is too large.')
  const size = limits.maxFrameBytes - 18
  const count = Math.ceil(payload.length / size)
  return Array.from({ length: count }, (_, index) => {
    const part = payload.subarray(index * size, (index + 1) * size)
    const bytes = new Uint8Array(part.length + 18)
    bytes[0] = FrameType.Chunk
    bytes[1] = type
    const view = new DataView(bytes.buffer)
    view.setUint32(2, transferId)
    view.setUint32(6, index)
    view.setUint32(10, count)
    view.setUint32(14, payload.length)
    bytes.set(part, 18)
    return bytes
  })
}

export class UpdateAssembler {
  private pending?: {
    frame: ChunkFrame
    bytes: Uint8Array
    next: number
    createdAt: number
  }

  push(frame: Frame | ChunkFrame): Frame | undefined {
    if (frame.type !== FrameType.Chunk) return frame
    const chunk = frame as ChunkFrame
    if (!this.pending) {
      if (chunk.index !== 0) throw new Error('Missing initial realtime chunk.')
      this.pending = {
        frame: chunk,
        bytes: new Uint8Array(chunk.total),
        next: 0,
        createdAt: Date.now(),
      }
    }
    const pending = this.pending
    if (
      Date.now() - pending.createdAt > 10_000 ||
      pending.frame.transferId !== chunk.transferId ||
      pending.next !== chunk.index ||
      pending.frame.total !== chunk.total ||
      pending.frame.originalType !== chunk.originalType
    )
      throw new Error('Invalid realtime chunk sequence.')
    pending.bytes.set(chunk.payload, chunk.index * (limits.maxFrameBytes - 18))
    pending.next++
    if (pending.next !== chunk.count) return
    this.pending = undefined
    return { type: chunk.originalType, payload: pending.bytes }
  }

  clear() {
    this.pending = undefined
  }
}

export function validateUpdate(payload: Uint8Array) {
  decodeUpdate(payload)
}
