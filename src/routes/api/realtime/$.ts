import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { handleRealtimeTicket } from '#/lib/documents/realtime/ticket.server'

function handlePost({ request }: { request: Request }) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '')
  if (pathname === '/api/realtime/ticket')
    return handleRealtimeTicket(request, env)
  return Response.json({ error: 'Not found.' }, { status: 404 })
}

function handleGet({ request }: { request: Request }) {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname === '/api/realtime/socket') {
    const fileId = url.searchParams.get('fileId')
    if (!fileId) return new Response('Missing fileId.', { status: 400 })
    const id = env.REALTIME.idFromName(fileId)
    return env.REALTIME.get(id).fetch(request)
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
