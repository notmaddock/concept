import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { handleDriveToken } from '#/lib/documents/drive/token.server'

function handleDrive({ request }: { request: Request }) {
  return handleDriveToken(request, env)
}

export const Route = createFileRoute('/api/drive/$')({
  server: {
    handlers: {
      GET: handleDrive,
      POST: handleDrive,
    },
  },
})
