import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '#/lib/auth/server'

async function handle({ request }: { request: Request }) {
  return getAuth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handle, POST: handle, OPTIONS: handle } },
})
