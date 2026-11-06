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
      })
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

    const room = this.createRoom()
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

    // Write the attachment before accepting: the runtime may deliver messages
    // to webSocketMessage as soon as the socket is attached, and that handler
    // reads this to rebuild the client.
    const admittedClient = room.client(adapterId)
    if (!admittedClient)
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as unknown as ResponseInit)
    server.serializeAttachment({
      adapterId,
      userId: admittedClient.userId,
      capabilities: admittedClient.capabilities,
    } satisfies SocketAttachment)
    this.ctx.acceptWebSocket(server, [socketTag])
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
    if (!isAttachment(attachment)) return
    const room = this.createRoom()
    room.restore(ws, attachment)
    const data = typeof message === 'string' ? message : new Uint8Array(message)
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
    const room = this.createRoom()
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment()
      if (isAttachment(attachment)) room.restore(ws, attachment)
    }
    await room.revalidate()
    await this.armRevalidation()
  }

  private async forget(ws: WorkersWebSocket): Promise<void> {
    // getWebSockets can still return a socket that is mid-close, so drop its
    // attachment to keep it from being rebuilt as a live client.
    ws.serializeAttachment(null)
    if (this.ctx.getWebSockets(socketTag).length === 0)
      await this.ctx.storage.deleteAlarm()
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
