declare module 'cloudflare:workers' {
  import type { CloudflareWorkersModule } from '@cloudflare/workers-types'

  export const env: Cloudflare.Env
  export const DurableObject: typeof CloudflareWorkersModule.DurableObject
}
