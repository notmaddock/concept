import { DurableObject } from 'cloudflare:workers'
import type {
  DurableObjectState,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'
import { DocumentRoom } from '#/lib/documents/realtime/room'
import type { RoomSocket } from '#/lib/documents/realtime/room'
import { createDriveVerifier } from '#/lib/documents/realtime/drive.server'
import { realtimePolicy } from '#/lib/documents/realtime/policy'

interface PendingSocket {
  adapterId: string
  /** Messages that arrived before admission finished; flushed after it. */
  queue: Array<string | Uint8Array>
  admitted: boolean
}

/**
 * One Durable Object per Drive fileId. Thin adapter between hibernated
 * WebSockets and `DocumentRoom`: it verifies the join ticket through the
 * room, revalidates Drive capabilities on a timer, and keeps all room logic
 * in `DocumentRoom`.
 */
export class DocumentRealtimeDO extends DurableObject {
  private readonly room: DocumentRoom
  private readonly fileId: string
  private readonly sockets = new Map<WorkersWebSocket, PendingSocket>()

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.fileId = ctx.id.name ?? ctx.id.toString()
    this.room = new DocumentRoom({
      fileId: this.fileId,
      secret: env.BETTER_AUTH_SECRET,
      verifier: createDriveVerifier(env, env.OAUTH_PROXY_URL),
    })
    setInterval(
      () => void this.room.revalidate(),
      realtimePolicy.revalidationIntervalMs,
    )
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
    this.ctx.acceptWebSocket(server)
    const pending: PendingSocket = {
      adapterId: crypto.randomUUID(),
      queue: [],
      admitted: false,
    }
    const adapter: RoomSocket = {
      id: pending.adapterId,
      send: (data) => server.send(data),
      close: (code, reason) => server.close(code, reason),
    }
    this.sockets.set(server, pending)
    const admitted = await this.room.admit(adapter, ticket)
    pending.admitted = admitted
    for (const message of pending.queue)
      this.room.receive(pending.adapterId, message)
    pending.queue.length = 0
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as unknown as ResponseInit)
  }

  webSocketMessage(ws: WorkersWebSocket, message: string | ArrayBuffer): void {
    const pending = this.sockets.get(ws)
    if (!pending) return
    const data = typeof message === 'string' ? message : new Uint8Array(message)
    if (pending.admitted) this.room.receive(pending.adapterId, data)
    else pending.queue.push(data)
  }

  webSocketClose(ws: WorkersWebSocket): void {
    this.removeSocket(ws)
  }

  webSocketError(ws: WorkersWebSocket): void {
    this.removeSocket(ws)
  }

  private removeSocket(ws: WorkersWebSocket): void {
    const pending = this.sockets.get(ws)
    if (!pending) return
    this.sockets.delete(ws)
    this.room.remove(pending.adapterId)
  }
}
