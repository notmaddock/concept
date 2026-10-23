// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

import worker from './worker'

const serverFetch = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: { fetch: serverFetch },
}))
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
  env: {},
}))

beforeEach(() => {
  serverFetch.mockReset()
})

it('attaches security headers and private no-store cache control to HTML responses', async () => {
  serverFetch.mockResolvedValue(
    new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  )

  const response = await worker.fetch(new Request('https://concept.example/'))

  expect(response.status).toBe(200)
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Referrer-Policy')).toBe(
    'strict-origin-when-cross-origin',
  )
  expect(response.headers.get('Strict-Transport-Security')).toBe(
    'max-age=31536000',
  )
  expect(response.headers.get('Permissions-Policy')).toBe(
    'camera=(), microphone=(), geolocation=()',
  )
  expect(response.headers.get('Cache-Control')).toBe(
    'private, no-cache, no-store, must-revalidate',
  )
})

it('preserves explicit Cache-Control and multiple Set-Cookie headers on non-HTML responses', async () => {
  const upstreamHeaders = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  upstreamHeaders.append('Set-Cookie', 'a=1; Path=/; HttpOnly')
  upstreamHeaders.append('Set-Cookie', 'b=2; Path=/; HttpOnly')
  serverFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: upstreamHeaders,
    }),
  )

  const response = await worker.fetch(
    new Request('https://concept.example/api/auth/session'),
  )

  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.getSetCookie()).toEqual([
    'a=1; Path=/; HttpOnly',
    'b=2; Path=/; HttpOnly',
  ])
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
})
