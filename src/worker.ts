import { handlePublicDrive } from './lib/documents/drive/public.server'
import server from '@tanstack/react-start/server-entry'
import { handleRealtime } from './lib/realtime/handler.server'

export { RealtimeRoom } from './lib/realtime/room.server'

export default {
  fetch(request: Request, bindings: Cloudflare.Env) {
    if (new URL(request.url).pathname.startsWith('/api/public-drive/'))
      return handlePublicDrive(request, bindings)
    if (new URL(request.url).pathname.startsWith('/api/realtime/'))
      return handleRealtime(request, bindings)
    return server.fetch(request)
  },
}
