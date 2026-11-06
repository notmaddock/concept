import type {
  WebSocket,
  WebSocketPair as WorkerWebSocketPair,
  Request as WorkerRequest,
  Response as WorkerResponse,
} from '@cloudflare/workers-types'
import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as decoding from 'lib0/decoding'
import { grantLifetimeMs } from './access.server'
import type { RealtimeGrant } from './access.server'
import {
  decodeFrame,
  encodeFrames,
  FrameType,
  UpdateAssembler,
} from './protocol'

declare const Response: typeof WorkerResponse
declare const WebSocketPair: typeof WorkerWebSocketPair

type Attachment = RealtimeGrant & {
  connectionId: string
  epoch: number
  windowStart: number
  messages: number
  bytes: number
  pending: number[]
}
type Epoch = { value: number; touchedAt: number }
const maxParticipants = 32
const maxBufferedBytes = 2 * 1024 * 1024

export class RealtimeRoom extends DurableObject<Cloudflare.Env> {
  private assemblers = new Map<WebSocket, UpdateAssembler>()
  private roomWindow = { startedAt: 0, messages: 0, bytes: 0 }
  private userWindows = new Map<
    string,
    { startedAt: number; messages: number; bytes: number }
  >()

  async beginAuthorization(userId: string): Promise<number> {
    const now = Date.now()
    return this.ctx.storage.transaction(async (storage) => {
      const epochs = await storage.list<Epoch>({ prefix: 'auth:' })
      for (const [key, epoch] of epochs) {
        if (epoch.touchedAt + grantLifetimeMs * 2 < now)
          await storage.delete(key)
      }
      if (epochs.size >= 128 && !epochs.has(`auth:${userId}`))
        throw new Error('Room authorization capacity exceeded')
      const previous = await storage.get<Epoch>(`auth:${userId}`)
      const value = (previous?.value ?? 0) + 1
      await storage.put(`auth:${userId}`, { value, touchedAt: now })
      return value
    })
  }

  async finishAuthorization(
    userId: string,
    epoch: number,
    grant: RealtimeGrant | null,
  ): Promise<boolean> {
    const current = await this.ctx.storage.get<Epoch>(`auth:${userId}`)
    if (current?.value !== epoch) return false
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment
      if (attachment.userId !== userId) continue
      if (
        !grant ||
        attachment.accountId !== grant.accountId ||
        grant.readOnly !== attachment.readOnly
      ) {
        this.assemblers.delete(socket)
        socket.serializeAttachment({ ...attachment, expiresAt: 0 })
        socket.close(4003, 'Access changed; revalidate')
      }
    }
    return true
  }

  async renewGrant(
    userId: string,
    connectionId: string,
    epoch: number,
    grant: RealtimeGrant,
  ): Promise<boolean> {
    const current = await this.ctx.storage.get<Epoch>(`auth:${userId}`)
    if (
      current?.value !== epoch ||
      grant.userId !== userId ||
      grant.expiresAt <= Date.now()
    )
      return false
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment
      if (
        attachment.userId !== userId ||
        attachment.connectionId !== connectionId
      )
        continue
      if (
        attachment.expiresAt <= Date.now() ||
        attachment.accountId !== grant.accountId ||
        attachment.readOnly !== grant.readOnly
      )
        return false
      socket.serializeAttachment({ ...attachment, ...grant, epoch })
      await this.scheduleExpiry()
      return true
    }
    return false
  }

  async fetch(request: WorkerRequest): Promise<WorkerResponse> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response(null, { status: 426 })
    try {
      const grant: RealtimeGrant | null = JSON.parse(
        request.headers.get('X-Concept-Grant') ?? '',
      )
      const epoch = Number(request.headers.get('X-Concept-Epoch'))
      if (
        !grant ||
        typeof grant.userId !== 'string' ||
        typeof grant.accountId !== 'string' ||
        typeof grant.readOnly !== 'boolean' ||
        !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt > Date.now() + grantLifetimeMs ||
        !Number.isSafeInteger(epoch)
      )
        return new Response(null, { status: 403 })
      return await this.join(grant, epoch)
    } catch {
      return new Response(null, { status: 403 })
    }
  }

  private async join(
    grant: RealtimeGrant,
    epoch: number,
  ): Promise<WorkerResponse> {
    const current = await this.ctx.storage.get<Epoch>(`auth:${grant.userId}`)
    if (current?.value !== epoch || grant.expiresAt <= Date.now())
      return new Response(null, { status: 409 })
    if (this.ctx.getWebSockets().length >= maxParticipants)
      return new Response(null, { status: 429 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    const attachment: Attachment = {
      ...grant,
      epoch,
      connectionId: crypto.randomUUID(),
      windowStart: Date.now(),
      messages: 0,
      bytes: 0,
      pending: [],
    }
    server.serializeAttachment(attachment)
    server.send(
      JSON.stringify({
        type: 'ready',
        connectionId: attachment.connectionId,
        accountId: grant.accountId,
        readOnly: grant.readOnly,
        expiresAt: grant.expiresAt,
      }),
    )
    await this.scheduleExpiry()
    return new Response(null, { status: 101, webSocket: client })
  }

  private authorized(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as Attachment | null
    if (!attachment || attachment.expiresAt <= Date.now()) {
      this.assemblers.delete(socket)
      socket.close(4001, 'Authorization expired')
      return null
    }
    return attachment
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    const attachment = this.authorized(socket)
    if (!attachment) return
    try {
      if (typeof message === 'string') throw new Error('Binary frames required')
      const frame = decodeFrame(new Uint8Array(message))
      const now = Date.now()
      if (attachment.windowStart + 1000 <= now) {
        attachment.windowStart = now
        attachment.messages = 0
        attachment.bytes = 0
      }
      attachment.messages++
      attachment.bytes += message.byteLength
      if (this.roomWindow.startedAt + 1000 <= now)
        this.roomWindow = { startedAt: now, messages: 0, bytes: 0 }
      this.roomWindow.messages++
      this.roomWindow.bytes += message.byteLength
      let userWindow = this.userWindows.get(attachment.userId)
      if (!userWindow || userWindow.startedAt + 1000 <= now) {
        userWindow = { startedAt: now, messages: 0, bytes: 0 }
        for (const [userId, window] of this.userWindows) {
          if (window.startedAt + 1000 <= now) this.userWindows.delete(userId)
        }
        this.userWindows.set(attachment.userId, userWindow)
      }
      userWindow.messages++
      userWindow.bytes += message.byteLength
      if (
        attachment.messages > 512 ||
        attachment.bytes > maxBufferedBytes ||
        this.roomWindow.messages > 16_384 ||
        this.roomWindow.bytes > maxBufferedBytes * 8 ||
        userWindow.messages > 1024 ||
        userWindow.bytes > maxBufferedBytes * 2
      )
        throw new Error('Rate limit exceeded')
      socket.serializeAttachment(attachment)
      if (frame.type === FrameType.Ack) {
        if (frame.payload.length || !attachment.pending.length)
          throw new Error('Invalid acknowledgment')
        attachment.pending.shift()
        socket.serializeAttachment(attachment)
        return
      }
      const mutation =
        frame.type === FrameType.Update ||
        frame.type === FrameType.SyncUpdate ||
        frame.type === FrameType.Chunk
      if (mutation && attachment.readOnly)
        throw new Error('Write access required')
      const assembler = this.assemblers.get(socket) ?? new UpdateAssembler()
      this.assemblers.set(socket, assembler)
      const complete = assembler.push(frame)
      if (!complete) return
      if (
        complete.type === FrameType.Update ||
        complete.type === FrameType.SyncUpdate
      )
        Y.decodeUpdate(complete.payload)
      else if (complete.type === FrameType.StateVector)
        Y.decodeStateVector(complete.payload)
      else if (complete.type === FrameType.Presence) {
        const decoder = decoding.createDecoder(complete.payload)
        const count = decoding.readVarUint(decoder)
        if (count > 32) throw new Error('Excessive presence entries')
        for (let index = 0; index < count; index++) {
          decoding.readVarUint(decoder)
          decoding.readVarUint(decoder)
          const state: unknown = JSON.parse(decoding.readVarString(decoder))
          if (
            state !== null &&
            (typeof state !== 'object' || Array.isArray(state))
          )
            throw new Error('Invalid presence')
        }
        if (decoding.hasContent(decoder))
          throw new Error('Trailing presence data')
      } else if (complete.type === FrameType.Publication) {
        if (complete.payload.length) throw new Error('Invalid publication hint')
      } else throw new Error('Invalid frame type')
      // Check the source again after assembly: expiry applies to the entire update.
      if (!this.authorized(socket)) return
      const outgoing = encodeFrames(
        complete.type,
        complete.payload,
        crypto.getRandomValues(new Uint32Array(1))[0],
      )
      for (const recipient of this.ctx.getWebSockets()) {
        if (recipient === socket || !this.authorized(recipient)) continue
        try {
          const target = recipient.deserializeAttachment() as Attachment
          const added = outgoing.reduce(
            (total, bytes) => total + bytes.byteLength,
            0,
          )
          const queued = target.pending.reduce(
            (total, bytes) => total + bytes,
            0,
          )
          if (
            queued + added > maxBufferedBytes + 1024 ||
            target.pending.length + outgoing.length > 256
          ) {
            recipient.close(4002, 'Slow recipient')
            continue
          }
          target.pending.push(...outgoing.map((bytes) => bytes.byteLength))
          recipient.serializeAttachment(target)
          for (const bytes of outgoing) recipient.send(bytes)
        } catch {
          recipient.close(4002, 'Slow recipient')
        }
      }
      console.log(
        JSON.stringify({
          event: 'realtime_batch',
          bytes: message.byteLength,
          frames: outgoing.length,
          participants: this.ctx.getWebSockets().length,
        }),
      )
    } catch {
      this.assemblers.delete(socket)
      socket.close(4002, 'Invalid or excessive realtime traffic')
    }
  }

  webSocketClose(socket: WebSocket) {
    this.assemblers.delete(socket)
  }
  webSocketError(socket: WebSocket) {
    this.assemblers.delete(socket)
    socket.close(1011, 'Transport failure')
  }

  private async scheduleExpiry() {
    const expiries = this.ctx
      .getWebSockets()
      .map((socket) => (socket.deserializeAttachment() as Attachment).expiresAt)
      .filter((expiry) => expiry > Date.now())
    if (expiries.length) await this.ctx.storage.setAlarm(Math.min(...expiries))
  }

  async alarm() {
    for (const socket of this.ctx.getWebSockets()) this.authorized(socket)
    await this.scheduleExpiry()
  }
}
