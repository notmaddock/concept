import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { handleRealtimeTicket } from '#/lib/documents/realtime/ticket.server'

export function handlePost({ request }: { request: Request }) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '')
  if (pathname === '/api/realtime/ticket')
    return handleRealtimeTicket(request, env)
  return Response.json({ error: 'Not found.' }, { status: 404 })
}

export async function handleGet({ request }: { request: Request }) {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname === '/api/realtime/socket') {
    if (env.REALTIME_ENABLED === 'false')
      return Response.json(
        { error: 'Realtime collaboration is disabled.' },
        { status: 503 },
      )
    if (!env.REALTIME)
      return Response.json(
        { error: 'Realtime collaboration is unavailable on this deployment.' },
        { status: 503 },
      )
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected a WebSocket upgrade request.', {
        status: 400,
      })
    const fileId = url.searchParams.get('fileId')
    if (!fileId) return new Response('Missing fileId.', { status: 400 })
    if (!url.searchParams.has('ticket') || !url.searchParams.get('ticket'))
      return new Response('Missing ticket.', { status: 400 })
    const id = env.REALTIME.idFromName(fileId)
    try {
      return await env.REALTIME.get(id).fetch(request)
    } catch (error) {
      console.error('Realtime socket handoff failed', error)
      return Response.json(
        { error: 'Realtime collaboration is temporarily unavailable.' },
        { status: 503 },
      )
    }
  }
  return Response.json({ error: 'Not found.' }, { status: 404 })
}

export const Route = createFileRoute('/api/realtime/$')({
  server: {
    handlers: {
      GET: handleGet,
      POST: handlePost,
    },
  },
})
