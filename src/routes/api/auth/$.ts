import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '#/lib/auth.server'

function handleAuth({ request }: { request: Request }) {
  return createAuth(env, new URL(request.url).origin).handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handleAuth,
      POST: handleAuth,
      OPTIONS: handleAuth,
    },
  },
})

export const APIRoute = Route

