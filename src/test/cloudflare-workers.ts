/**
 * Node stand-in for the Workers-only `cloudflare:workers` module, aliased in
 * `vitest.config.ts`. Only what the Durable Object classes extend is needed.
 */
export abstract class DurableObject<T = unknown> {
  protected ctx: unknown
  protected env: T
  constructor(ctx: unknown, env: T) {
    this.ctx = ctx
    this.env = env
  }
}

export const env = {} as Record<string, string | undefined>
