import { DurableObject } from 'cloudflare:workers'
import type {
  DurableObjectState,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'
import { DocumentRoom } from '#/lib/documents/realtime/room'
import { createDriveVerifier } from '#/lib/documents/realtime/drive.server'
import { parseClientControlMessage } from '#/lib/documents/realtime/protocol'
import { realtimePolicy } from '#/lib/documents/realtime/policy'
import type { DocumentCapabilities } from '#/lib/documents/realtime/capabilities'

/**
 * Per-socket state persisted with the WebSocket itself. Hibernation discards
 * every in-memory field, so anything needed after a wake-up must live here.
 */
interface SocketAttachment {
  adapterId: string
  userId: string
  capabilities: DocumentCapabilities
}

const socketTag = 'room'
/** Storage key for the last time the room saw a join or a save. */
const lastActiveKey = 'lastActiveAt'

function isAttachment(value: unknown): value is SocketAttachment {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Record<string, unknown>
  return (
    typeof attachment.adapterId === 'string' &&
    typeof attachment.userId === 'string' &&
    !!attachment.capabilities &&
    typeof attachment.capabilities === 'object'
  )
}

function isPublication(data: string): boolean {
  return parseClientControlMessage(data)?.type === 'publication'
}

/**
 * One Durable Object per Drive fileId. Thin adapter between hibernated
 * WebSockets and `DocumentRoom`: it verifies the join ticket through the
 * room, revalidates Drive capabilities on an alarm, and keeps all room logic
 * in `DocumentRoom`.
 *
 * Everything here is written to survive hibernation: no `setInterval`, no
 * `waitUntil`, and no in-memory map that outlives a socket. Revalidation runs
 * on `storage.setAlarm`, which is only armed while clients are connected, so
 * an idle room costs nothing and a room with clients wakes briefly once per
 * `revalidationIntervalMs` instead of staying resident.
 */
export class DocumentRealtimeDO extends DurableObject {
  private readonly fileId: string
  private readonly createRoom: () => DocumentRoom
  private room?: DocumentRoom
  /** Frames that arrived before the socket's attachment was written. */
  private readonly pendingFrames = new Map<
    WorkersWebSocket,
    Array<string | ArrayBuffer>
  >()
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.fileId = ctx.id.name ?? ctx.id.toString()
    const verifier = createDriveVerifier(env, env.OAUTH_PROXY_URL)
    // Rebuilt on demand: the room holds Yjs docs and verdicts that must not
    // outlive a hibernation, and constructing it eagerly on every wake-up
    // would pay for state no event needs.
    this.createRoom = () =>
      new DocumentRoom({
        fileId: this.fileId,
        secret: env.BETTER_AUTH_SECRET,
        verifier,
        onCapabilitiesChanged: (adapterId, capabilities) =>
          this.persistCapabilities(adapterId, capabilities),
      })
  }

  /**
   * Writes revalidated capabilities back onto the socket attachment. Without
   * this a wake-up rebuilds the client from the ticket-time snapshot, silently
   * restoring a downgraded or revoked user's original rights.
   */
  private persistCapabilities(
    adapterId: string,
    capabilities: DocumentCapabilities,
  ): void {
    for (const ws of this.ctx.getWebSockets(socketTag)) {
      const attachment = ws.deserializeAttachment()
      if (!isAttachment(attachment) || attachment.adapterId !== adapterId)
        continue
      // Revalidation runs every minute; skip the write when nothing changed.
      const current = attachment.capabilities
      if (
        current.view === capabilities.view &&
        current.edit === capabilities.edit &&
        current.comment === capabilities.comment
      )
        continue
      ws.serializeAttachment({ ...attachment, capabilities })
    }
  }
  private getRoom(): DocumentRoom {
    if (!this.room) {
      this.room = this.createRoom()
      for (const ws of this.ctx.getWebSockets(socketTag)) {
        const attachment = ws.deserializeAttachment()
        if (isAttachment(attachment)) this.room.restore(ws, attachment)
        else
          console.warn('[realtime] socket without a valid attachment; skipping')
      }
    }
    return this.room
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected a WebSocket upgrade request.', {
        status: 400,
      })
    const url = new URL(request.url)
    const fileId = url.searchParams.get('fileId')
    const ticket = url.searchParams.get('ticket')
    if (!fileId || fileId !== this.fileId)
      return new Response('fileId does not match this room.', { status: 400 })
    if (!ticket) return new Response('Missing ticket.', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    const room = this.getRoom()

    // Accept before anything sends: the runtime rejects send() on a socket
    // that has not been accepted, and admission replies with `admitted`.
    this.ctx.acceptWebSocket(server, [socketTag])

    const adapterId = crypto.randomUUID()
    const admitted = await room.admit(
      {
        id: adapterId,
        send: (data) => server.send(data),
        close: (code, reason) => server.close(code, reason),
      },
      ticket,
    )
    if (!admitted)
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as unknown as ResponseInit)

    const admittedClient = room.client(adapterId)
    if (!admittedClient) {
      console.warn('[realtime] admission lost; closing socket 1011')
      server.close(1011, 'admission lost')
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as unknown as ResponseInit)
    }
    const attachment: SocketAttachment = {
      adapterId,
      userId: admittedClient.userId,
      capabilities: admittedClient.capabilities,
    }
    server.serializeAttachment(attachment)
    await this.flushPendingFrames(server, attachment)
    await this.markActive()
    await this.armRevalidation()
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as unknown as ResponseInit)
  }

  async webSocketMessage(
    ws: WorkersWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment()
    // Messages can arrive between acceptWebSocket and serializeAttachment.
    // Dropping them would lose the client's opening sync step, so hold the
    // frame until the attachment lands.
    if (!isAttachment(attachment)) {
      this.pendingFrames.set(ws, [
        ...(this.pendingFrames.get(ws) ?? []),
        message,
      ])
      return
    }
    const room = this.getRoom()
    const data = typeof message === 'string' ? message : new Uint8Array(message)
    if (!room.hasClient(attachment.adapterId))
      // The socket is attached but the room could not rebuild it; without this
      // the frame is dropped and the client sees an unexplained stall.
      console.warn('[realtime] frame for an unknown adapter; dropping')
    room.receive(attachment.adapterId, data)
    // A save may have changed the ACL; it also means the room is active, so
    // keep revalidation on the fast cadence and re-arm for the next pass.
    if (typeof data === 'string' && isPublication(data)) {
      await this.markActive()
      await this.armRevalidation()
    }
  }

  async webSocketClose(ws: WorkersWebSocket): Promise<void> {
    await this.forget(ws)
  }

  async webSocketError(ws: WorkersWebSocket): Promise<void> {
    await this.forget(ws)
  }

  /**
   * Wakes once per revalidation interval while clients are attached. An alarm
   * that finds nobody connected stops rearming, which is what lets the object
   * hibernate.
   */
  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets(socketTag)
    if (sockets.length === 0) return
    const room = this.getRoom()
    await room.revalidate()
    await this.armRevalidation()
  }

  /** Replays frames held while the socket had no attachment yet. */
  private async flushPendingFrames(
    ws: WorkersWebSocket,
    attachment: SocketAttachment,
  ): Promise<void> {
    const frames = this.pendingFrames.get(ws)
    if (!frames) return
    this.pendingFrames.delete(ws)
    const room = this.getRoom()
    for (const frame of frames)
      room.receive(
        attachment.adapterId,
        typeof frame === 'string' ? frame : new Uint8Array(frame),
      )
  }

  private async forget(ws: WorkersWebSocket): Promise<void> {
    // getWebSockets can still return a socket that is mid-close, so drop its
    // attachment to keep it from being rebuilt as a live client.
    this.pendingFrames.delete(ws)
    const attachment = ws.deserializeAttachment()
    if (isAttachment(attachment)) {
      this.room?.remove(attachment.adapterId)
    }
    ws.serializeAttachment(null)
    const remaining = this.ctx
      .getWebSockets(socketTag)
      .filter(
        (s) =>
          s !== ws &&
          s.readyState === WebSocket.OPEN &&
          isAttachment(s.deserializeAttachment()),
      )
    if (remaining.length === 0) {
      await this.ctx.storage.deleteAlarm()
      this.room = undefined
    }
  }

  private async armRevalidation(): Promise<void> {
    const at = Date.now() + (await this.revalidationDelayMs())
    // getAlarm() reports null while this handler is running, so a running
    // alarm always re-arms, which is the behaviour we want here.
    const existing = await this.ctx.storage.getAlarm()
    // Never push a scheduled pass back: a burst of joins must not starve it.
    if (existing === null || existing > at) await this.ctx.storage.setAlarm(at)
  }

  /**
   * Fast cadence while the room is active, slow cadence once it has been
   * quiet. Saves already trigger a revalidation through the publication hint,
   * so the timer only needs to catch ACL changes that arrive without a save.
   */
  private async revalidationDelayMs(): Promise<number> {
    const lastActive = await this.ctx.storage.get<number>(lastActiveKey)
    if (lastActive === undefined) return realtimePolicy.revalidationIntervalMs
    const idleFor = Date.now() - lastActive
    return idleFor >= realtimePolicy.idleAfterMs
      ? realtimePolicy.idleRevalidationIntervalMs
      : realtimePolicy.revalidationIntervalMs
  }

  /** Records activity so revalidation can back off once the room goes quiet. */
  private async markActive(): Promise<void> {
    await this.ctx.storage.put(lastActiveKey, Date.now())
  }
}
