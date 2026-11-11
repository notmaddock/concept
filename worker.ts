import serverEntry from '@tanstack/react-start/server-entry'
import { withSecurityHeaders } from './src/worker/security-headers'

type WorkerContext = {
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException: () => void
}

const entry = serverEntry as {
  fetch: (
    request: Request,
    env: Env,
    context: WorkerContext,
  ) => Promise<Response>
}

export default {
  fetch(request: Request, env: Env, context: WorkerContext) {
    return entry.fetch(request, env, context).then(withSecurityHeaders)
  },
}

export { DocumentRealtimeDO } from './src/worker/realtime-do'
