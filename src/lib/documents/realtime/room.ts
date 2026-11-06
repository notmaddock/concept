import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  writeSyncStep2,
} from 'y-protocols/sync'
import { realtimePolicy } from './policy'
import { encodeControlMessage, parseClientControlMessage } from './protocol'
import { verifyRealtimeTicket } from './ticket'
import type { DocumentCapabilities } from './capabilities'
import type { RealtimePolicy } from './policy'

/** y-protocols awareness messages start with this tag (not exported by y-protocols). */
const messageAwareness = 3

/** A connected socket as seen by the room; the DO adapts WebSocket to this. */
export interface RoomSocket {
  readonly id: string
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
}

/** Drive-backed capability check for one user; undefined means no access. */
export interface DriveVerifier {
  verify(fileId: string, userId: string): Promise<DocumentCapabilities | undefined>
}

export interface DocumentRoomDeps {
  fileId: string
  secret: string
  verifier: DriveVerifier
  now?: () => number
  policy?: Partial<RealtimePolicy>
}

interface RoomClient {
  socket: RoomSocket
  userId: string
  capabilities: DocumentCapabilities
}

interface Verdict {
  at: number
  capabilities: DocumentCapabilities | undefined
}

/**
 * One room per Drive fileId. Routes y-protocols messages between connected
 * clients, buffers recent updates so a late joiner can catch up, enforces the
 * `edit` capability server-side, and revokes clients whose Drive capabilities
 * were lost. The buffer is a cache, never a source of truth: Drive remains the
 * only durable store.
 */
export class DocumentRoom {
  private readonly fileId: string
  private readonly secret: string
  private readonly verifier: DriveVerifier
  private readonly now: () => number
  private readonly policy: RealtimePolicy
  private readonly clients = new Map<string, RoomClient>()
  private readonly verdicts = new Map<string, Verdict>()
  private buffer = new Doc()
  private bufferedUpdates = 0

  constructor(deps: DocumentRoomDeps) {
    this.fileId = deps.fileId
    this.secret = deps.secret
    this.verifier = deps.verifier
    this.now = deps.now ?? (() => Date.now())
    this.policy = { ...realtimePolicy, ...deps.policy }
  }

  clientCount() {
    return this.clients.size
  }

  /** Verifies the ticket and admits the socket. Returns false when rejected. */
  async admit(socket: RoomSocket, ticket: string): Promise<boolean> {
    const payload = await verifyRealtimeTicket(ticket, this.secret, this.now())
    if (!payload || payload.fileId !== this.fileId || !payload.capabilities.view) {
      socket.send(
        encodeControlMessage({ type: 'error', message: 'Invalid or expired ticket.' }),
      )
      socket.close(4401, 'invalid ticket')
      return false
    }
    this.clients.set(socket.id, {
      socket,
      userId: payload.userId,
      capabilities: payload.capabilities,
    })
    socket.send(
      encodeControlMessage({ type: 'admitted', capabilities: payload.capabilities }),
    )
    // Socket (re)connect triggers a server-side revalidation of this user.
    // Usually served from the verdict cache, so no extra Drive call.
    await this.revalidateUser(payload.userId)
    return true
  }

  receive(socketId: string, data: string | Uint8Array): void {
    const client = this.clients.get(socketId)
    if (!client) return
    if (typeof data === 'string') {
      this.receiveControl(client, data)
      return
    }
    if (data.byteLength === 0) return
    const messageType = data[0]
    if (messageType === messageYjsSyncStep1) {
      // Catch the joiner up from the buffered cache; Drive reconciles the rest.
      const decoder = decoding.createDecoder(data)
      decoding.readVarUint(decoder) // message type
      const vector = decoding.readVarUint8Array(decoder)
      const encoder = encoding.createEncoder()
      writeSyncStep2(encoder, this.buffer, vector)
      client.socket.send(encoding.toUint8Array(encoder))
      return
    }
    if (messageType === messageYjsUpdate || messageType === messageYjsSyncStep2) {
      if (!client.capabilities.edit) {
        client.socket.send(
          encodeControlMessage({
            type: 'error',
            message: 'Edit permission is required to send document updates.',
          }),
        )
        return
      }
      // Strip the frame to buffer the raw update; relay the original frame.
      const decoder = decoding.createDecoder(data)
      decoding.readVarUint(decoder) // message type
      const update = decoding.readVarUint8Array(decoder)
      this.relayUpdate(client, update, data)
      return
    }
    if (messageType === messageAwareness) {
      // Awareness is allowed for all admitted users.
      this.relay(client, data)
    }
  }

  remove(socketId: string): void {
    this.clients.delete(socketId)
    if (this.clients.size === 0) {
      // Nobody is listening; drop the cache so a cold room holds no state.
      this.buffer.destroy()
      this.buffer = new Doc()
      this.bufferedUpdates = 0
      this.verdicts.clear()
    }
  }

  /** Drops the cached verdict for a user so the next pass re-checks Drive. */
  invalidateVerdict(userId: string): void {
    this.verdicts.delete(userId)
  }

  /** A Drive publication hint: permissions may have changed, re-check now. */
  notifyPublication(): void {
    // A save may have changed the ACL, so cached verdicts no longer count.
    this.verdicts.clear()
    void this.revalidate()
  }

  /** One revalidation pass over all connected clients (one Drive call per user). */
  async revalidate(): Promise<void> {
    const userIds = new Set([...this.clients.values()].map((client) => client.userId))
    await Promise.all([...userIds].map((userId) => this.revalidateUser(userId)))
  }

  private async revalidateUser(userId: string): Promise<void> {
    let verdict = this.verdicts.get(userId)
    if (!verdict || this.now() - verdict.at >= this.policy.verdictCacheTtlMs) {
      const capabilities = await this.verifier.verify(this.fileId, userId)
      verdict = { at: this.now(), capabilities }
      this.verdicts.set(userId, verdict)
    }
    for (const client of [...this.clients.values()]) {
      if (client.userId !== userId) continue
      const fresh = verdict.capabilities
      if (!fresh || !fresh.view) {
        // Loss of view closes the socket.
        client.capabilities = { view: false, edit: false, comment: false }
        client.socket.send(
          encodeControlMessage({
            type: 'revoked',
            capabilities: client.capabilities,
          }),
        )
        client.socket.close(4403, 'access revoked')
        this.clients.delete(client.socket.id)
        continue
      }
      const lost =
        (client.capabilities.edit && !fresh.edit) ||
        (client.capabilities.comment && !fresh.comment)
      client.capabilities = fresh
      if (lost) {
        // Loss of edit (but not view) downgrades to awareness-only.
        client.socket.send(
          encodeControlMessage({ type: 'revoked', capabilities: fresh }),
        )
      }
    }
  }

  private receiveControl(client: RoomClient, data: string): void {
    const message = parseClientControlMessage(data)
    if (!message) return
    if (message.type === 'capabilities') {
      // Client-provided snapshots accelerate, never replace, the server check.
      this.invalidateVerdict(client.userId)
      void this.revalidateUser(client.userId)
    } else if (message.type === 'publication') {
      this.notifyPublication()
    }
  }

  private relayUpdate(client: RoomClient, update: Uint8Array, frame: Uint8Array): void {
    try {
      applyUpdate(this.buffer, update)
      this.bufferedUpdates++
      if (this.bufferedUpdates > this.policy.bufferedUpdates) {
        // Compact the cache so it stays bounded; content is unchanged.
        const compacted = new Doc()
        applyUpdate(compacted, encodeStateAsUpdate(this.buffer))
        this.buffer.destroy()
        this.buffer = compacted
        this.bufferedUpdates = 1
      }
    } catch {
      // A malformed update must not break the room; drop it.
      return
    }
    this.relay(client, frame)
  }

  private relay(sender: RoomClient, data: string | Uint8Array): void {
    for (const client of this.clients.values())
      if (client.socket.id !== sender.socket.id) client.socket.send(data)
  }
}
