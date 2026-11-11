import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, withSecurityHeaders } from './security-headers'

describe('security headers', () => {
  it('builds a CSP with the planned embed frame sources', () => {
    const policy = contentSecurityPolicy()
    expect(policy).toContain(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.figma.com https://platform.twitter.com',
    )
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain('wss:')
    expect(policy).toContain("img-src 'self' data: blob:")
  })

  it('adds headers without dropping the response body', async () => {
    const response = withSecurityHeaders(
      new Response('hello', { status: 200, headers: { 'X-Test': '1' } }),
    )
    expect(response.headers.get('Content-Security-Policy')).toBe(
      contentSecurityPolicy(),
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Test')).toBe('1')
    expect(await response.text()).toBe('hello')
  })

  it('leaves websocket upgrades untouched', () => {
    const response = Object.assign(new Response(null), {
      webSocket: {},
    }) as unknown as Response
    expect(withSecurityHeaders(response)).toBe(response)
  })
})
