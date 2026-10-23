// @vitest-environment node
import { expect, it, vi } from 'vitest'

const handler = vi.hoisted(() => vi.fn())
vi.mock('#/lib/auth/server', () => ({
  getAuth: () => ({ handler }),
}))

import { Route } from './$'

it('forwards GET, POST, and OPTIONS requests to the Better Auth handler', async () => {
  const handlers = Route.options.server?.handlers as Record<
    string,
    (ctx: { request: Request }) => Promise<Response>
  >
  expect(handlers.GET).toBeTypeOf('function')
  expect(handlers.POST).toBeTypeOf('function')
  expect(handlers.OPTIONS).toBeTypeOf('function')

  for (const method of ['GET', 'POST', 'OPTIONS'] as const) {
    const request = new Request('https://concept.example/api/auth/session', {
      method,
    })
    handler.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await handlers[method]({ request })
    expect(response.status).toBe(204)
    expect(handler).toHaveBeenLastCalledWith(request)
  }
})
