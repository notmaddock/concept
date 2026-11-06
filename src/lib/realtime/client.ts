import {
  applyUpdate,
  encodeStateAsUpdate,
  encodeStateVector,
  mergeUpdates,
} from 'yjs'
import type { Doc } from 'yjs'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import { realtime, realtimeConfig } from './config'
import type { RealtimeConfig } from './config'
import {
  FrameType,
  UpdateAssembler,
  decodeFrame,
  encodeFrames,
  limits,
  validateUpdate,
} from './protocol'

export const realtimeOrigin = Symbol('realtime')

interface Options {
  doc: Doc
  fileId: string
  resourceKey?: string
  canWrite: () => boolean
  onPublication: () => unknown
  onAccess: () => unknown
  config?: Partial<RealtimeConfig>
}

export class RealtimeClient {
  private config: RealtimeConfig
  private socket?: WebSocket
  private stopped = true
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private retry?: ReturnType<typeof setTimeout>
  private presenceTimer?: ReturnType<typeof setTimeout>
  private updates: Array<Uint8Array> = []
  private queuedBytes = 0
  private transferId = 0
  private writable = false
  private assembler = new UpdateAssembler()
  private awareness?: Awareness
  private latestPresence?: Uint8Array
  private expiresAt = 0
  private seenVectors = new Set<string>()
  private isCurrent = (generation: number) =>
    !this.stopped && generation === this.generation

  constructor(private options: Options) {
    this.config = realtimeConfig({ ...realtime, ...options.config })
  }

  start() {
    if (!this.stopped || !this.config.enabled) return
    this.stopped = false
    this.options.doc.on('update', this.changed)
    void this.connect()
  }

  private clearQueue() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.updates = []
    this.queuedBytes = 0
  }

  private scheduleReconnect() {
    if (this.stopped) return
    clearTimeout(this.retry)
    this.retry = setTimeout(() => void this.connect(), 5000)
  }

  private async connect() {
    const generation = ++this.generation
    this.clearQueue()
    this.assembler.clear()
    this.seenVectors.clear()
    this.socket?.close()
    this.socket = undefined
    try {
      const query = new URLSearchParams({ fileId: this.options.fileId })
      if (this.options.resourceKey)
        query.set('resourceKey', this.options.resourceKey)
      const response = await fetch(`/api/realtime/access?${query}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!this.isCurrent(generation)) return
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          this.options.onAccess()
          this.stop()
        } else this.scheduleReconnect()
        return
      }
      const grant = (await response.json()) as {
        readOnly: boolean
        expiresAt: number
      }
      if (!this.isCurrent(generation)) return
      if (
        typeof grant.readOnly !== 'boolean' ||
        !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt <= Date.now()
      )
        throw new Error('Invalid realtime grant.')
      this.writable = !grant.readOnly
      this.expiresAt = Math.min(grant.expiresAt, Date.now() + 60_000)
      const url = new URL(`/api/realtime/socket?${query}`, location.origin)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      socket.onopen = () => {
        if (this.stopped || generation !== this.generation) {
          socket.close()
          return
        }
        this.send(FrameType.StateVector, encodeStateVector(this.options.doc))
        this.queuePresence()
        clearTimeout(this.retry)
        this.retry = setTimeout(
          () => void this.connect(),
          Math.min(30_000, this.expiresAt - Date.now()),
        )
      }
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (
          this.stopped ||
          generation !== this.generation ||
          Date.now() >= this.expiresAt
        )
          return
        try {
          if (typeof event.data === 'string') {
            const ready = JSON.parse(event.data) as {
              type?: string
              readOnly?: boolean
              expiresAt?: number
            }
            if (
              ready.type !== 'ready' ||
              typeof ready.readOnly !== 'boolean' ||
              !Number.isFinite(ready.expiresAt)
            )
              throw new Error('Invalid realtime ready frame.')
            this.writable = !ready.readOnly
            this.expiresAt = Math.min(this.expiresAt, ready.expiresAt!)
            if (!this.writable) this.clearQueue()
            return
          }
          if (!(event.data instanceof ArrayBuffer))
            throw new Error('Invalid realtime data.')
          this.send(FrameType.Ack, new Uint8Array())
          const frame = this.assembler.push(
            decodeFrame(new Uint8Array(event.data)),
          )
          if (!frame) return
          if (frame.type === FrameType.StateVector) {
            const key = Array.from(frame.payload).join(',')
            if (!this.seenVectors.has(key)) {
              if (this.seenVectors.size >= 128) this.seenVectors.clear()
              this.seenVectors.add(key)
              this.send(
                FrameType.StateVector,
                encodeStateVector(this.options.doc),
              )
            }
            if (this.canWrite())
              this.send(
                FrameType.SyncUpdate,
                encodeStateAsUpdate(this.options.doc, frame.payload),
              )
          } else if (
            frame.type === FrameType.Update ||
            frame.type === FrameType.SyncUpdate
          ) {
            validateUpdate(frame.payload)
            applyUpdate(this.options.doc, frame.payload, realtimeOrigin)
          } else if (frame.type === FrameType.Publication)
            this.options.onPublication()
          else if (frame.type === FrameType.Presence && this.awareness)
            applyAwarenessUpdate(this.awareness, frame.payload, realtimeOrigin)
        } catch {
          this.stop()
        }
      }
      socket.onclose = () => {
        if (this.stopped || generation !== this.generation) return
        this.clearQueue()
        this.scheduleReconnect()
      }
      socket.onerror = () => socket.close()
    } catch {
      if (generation === this.generation) this.scheduleReconnect()
    }
  }

  private canWrite() {
    return (
      this.writable && this.options.canWrite() && Date.now() < this.expiresAt
    )
  }

  private send(type: FrameType, payload: Uint8Array) {
    if (
      this.socket?.readyState !== WebSocket.OPEN ||
      Date.now() >= this.expiresAt
    )
      return
    if (
      (type === FrameType.Update || type === FrameType.SyncUpdate) &&
      !this.canWrite()
    ) {
      this.clearQueue()
      return
    }
    const frames = encodeFrames(type, payload, ++this.transferId)
    const bytes = frames.reduce((total, frame) => total + frame.byteLength, 0)
    if (this.socket.bufferedAmount + bytes > limits.maxQueuedBytes) {
      this.stop()
      return
    }
    frames.forEach((frame) => this.socket!.send(new Uint8Array(frame).buffer))
  }

  private changed = (update: Uint8Array, origin: unknown) => {
    if (
      origin === realtimeOrigin ||
      !this.canWrite() ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return
    this.queuedBytes += update.byteLength
    if (this.queuedBytes > limits.maxQueuedBytes) {
      this.stop()
      return
    }
    this.updates.push(update)
    this.timer ??= setTimeout(() => {
      const updates = this.updates
      this.clearQueue()
      if (!updates.length || !this.canWrite()) return
      try {
        this.send(FrameType.Update, mergeUpdates(updates))
      } catch {
        this.stop()
      }
    }, this.config.updatePeriodMs)
  }

  publish() {
    try {
      this.send(FrameType.Publication, new Uint8Array())
    } catch {
      this.stop()
    }
  }

  attachAwareness(awareness: Awareness) {
    this.awareness?.off('update', this.presenceChanged)
    this.awareness = awareness
    awareness.on('update', this.presenceChanged)
    this.queuePresence()
    return () => {
      awareness.off('update', this.presenceChanged)
      if (this.awareness === awareness) this.awareness = undefined
    }
  }

  private presenceChanged = (_changes: unknown, origin: unknown) => {
    if (origin !== realtimeOrigin) this.queuePresence()
  }

  private queuePresence() {
    if (this.stopped || !this.awareness) return
    this.latestPresence = encodeAwarenessUpdate(this.awareness, [
      this.options.doc.clientID,
    ])
    this.presenceTimer ??= setTimeout(() => {
      this.presenceTimer = undefined
      const presence = this.latestPresence
      this.latestPresence = undefined
      if (presence && presence.length < limits.maxPresenceBytes) {
        try {
          this.send(FrameType.Presence, presence)
        } catch {
          this.stop()
        }
      }
    }, this.config.presencePeriodMs)
  }

  stop() {
    this.stopped = true
    ++this.generation
    this.clearQueue()
    clearTimeout(this.retry)
    clearTimeout(this.presenceTimer)
    this.presenceTimer = undefined
    this.latestPresence = undefined
    this.options.doc.off('update', this.changed)
    this.awareness?.off('update', this.presenceChanged)
    this.socket?.close()
    this.socket = undefined
  }
}
