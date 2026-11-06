/* eslint-disable @typescript-eslint/consistent-type-imports -- global .d.ts cannot use top-level imports without becoming a module */
type WorkersDurableObjectState =
  import('@cloudflare/workers-types').DurableObjectState
type WorkersWebSocket = import('@cloudflare/workers-types').WebSocket

declare const WebSocketPair: {
  new (): { 0: WorkersWebSocket; 1: WorkersWebSocket }
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env

  export abstract class DurableObject<T = Cloudflare.Env> {
    protected ctx: WorkersDurableObjectState
    protected env: T
    constructor(ctx: WorkersDurableObjectState, env: T)
  }
}

declare namespace Cloudflare {
  interface Env {
    /** Deployment-level kill switch for realtime collaboration. */
    REALTIME_ENABLED?: string
  }
}
