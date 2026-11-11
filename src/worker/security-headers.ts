const embedFrameSources = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.figma.com',
  'https://platform.twitter.com',
]

/*
 * `script-src` and `style-src` need `'unsafe-inline'`: TanStack Start inlines
 * its hydration bootstrap and the app uses React inline styles plus the
 * PostHog snippet. Everything else is restricted to the origins the app
 * actually calls (Google Drive/Picker, PostHog, same-origin realtime sockets).
 */
const directives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    'https://apis.google.com',
    'https://us.i.posthog.com',
  ],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://www.googleapis.com',
    'https://*.googleusercontent.com',
    'https://drive.google.com',
  ],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://www.googleapis.com',
    'https://oauth2.googleapis.com',
    'https://us.i.posthog.com',
    'wss:',
  ],
  'frame-src': embedFrameSources,
  'worker-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'blob:', 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
}

export function contentSecurityPolicy() {
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ')
}

export function withSecurityHeaders(response: Response): Response {
  const upgrade = response as Response & { webSocket?: unknown }
  if (response.status === 101 || upgrade.webSocket) return response
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', contentSecurityPolicy())
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
