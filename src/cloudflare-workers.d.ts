/* eslint-disable @typescript-eslint/consistent-type-imports -- Top-level imports would turn these ambient module declarations into augmentations. */
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env
  export const DurableObject: typeof import('@cloudflare/workers-types').CloudflareWorkersModule.DurableObject
}

declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair
interface ResponseInit {
  webSocket?: import('@cloudflare/workers-types').WebSocket
}
