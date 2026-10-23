import serverEntry from '@tanstack/react-start/server-entry'

export { DriveSaveCoordinator } from './lib/documents/drive/coordinator'

export default {
  async fetch(request: Request) {
    const response = await serverEntry.fetch(request)
    const headers = new Headers(response.headers)

    if (!headers.has('X-Content-Type-Options'))
      headers.set('X-Content-Type-Options', 'nosniff')
    if (!headers.has('X-Frame-Options'))
      headers.set('X-Frame-Options', 'DENY')
    if (!headers.has('Referrer-Policy'))
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (!headers.has('Strict-Transport-Security'))
      headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      )
    if (!headers.has('Permissions-Policy'))
      headers.set(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      )

    const contentType = headers.get('content-type') ?? ''
    if (!headers.has('Cache-Control') && contentType.includes('text/html')) {
      headers.set(
        'Cache-Control',
        'private, no-cache, no-store, must-revalidate',
      )
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
