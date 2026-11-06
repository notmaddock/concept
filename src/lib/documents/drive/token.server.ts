import { createAuth } from '#/lib/auth.server'

const driveScope = 'https://www.googleapis.com/auth/drive.file'

function configured(bindings: Partial<Cloudflare.Env>) {
  return Boolean(
    bindings.DB &&
    bindings.BETTER_AUTH_SECRET &&
    bindings.GOOGLE_CLIENT_ID &&
    bindings.GOOGLE_CLIENT_SECRET &&
    bindings.AUTH_TRUSTED_ORIGINS &&
    bindings.OAUTH_PROXY_URL &&
    bindings.OAUTH_PROXY_SECRET,
  )
}

function forwardCookies(source: Headers, target: Headers) {
  for (const cookie of source.getSetCookie())
    target.append('Set-Cookie', cookie)
}

function authFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const body = 'body' in error ? error.body : undefined
  if (
    body &&
    typeof body === 'object' &&
    'code' in body &&
    ['FAILED_TO_GET_ACCESS_TOKEN', 'FAILED_TO_REFRESH_ACCESS_TOKEN'].includes(
      String(body.code),
    )
  )
    // Better Auth also uses these codes for transient refresh failures.
    return false
  return (
    ('statusCode' in error &&
      [400, 401, 403].includes(Number(error.statusCode))) ||
    ('status' in error &&
      ['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN'].includes(
        String(error.status),
      ))
  )
}

async function forceRefreshRequested(request: Request) {
  if (!request.body) return false
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new Error('Invalid token request')
  const options: unknown = await request.json()
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'forceRefresh')
  )
    throw new Error('Invalid token request')
  if ('forceRefresh' in options && typeof options.forceRefresh !== 'boolean')
    throw new Error('Invalid token request')
  return 'forceRefresh' in options && options.forceRefresh === true
}

export async function handleDriveToken(
  request: Request,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '')
  const sessionRequest = pathname === '/api/drive/session'
  const tokenRequest = pathname === '/api/drive/token'
  const responseHeaders = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
  })
  const json = (value: object, status = 200) =>
    Response.json(value, { status, headers: responseHeaders })
  const reconnect = () => json({ error: 'Reconnect Google Drive.' }, 401)
  if (!sessionRequest && !tokenRequest)
    return json({ error: 'Not found.' }, 404)
  if (request.method !== (sessionRequest ? 'GET' : 'POST')) {
    responseHeaders.set('Allow', sessionRequest ? 'GET' : 'POST')
    return json({ error: 'Method not allowed.' }, 405)
  }
  if (tokenRequest && request.headers.get('Origin') !== url.origin)
    return json({ error: 'Invalid request origin.' }, 403)
  if (!configured(bindings))
    return sessionRequest
      ? json({ connected: false, configured: false }, 503)
      : json({ error: 'Google Drive is not configured.' }, 503)
  let forceRefresh = false
  if (tokenRequest) {
    try {
      forceRefresh = await forceRefreshRequested(request)
    } catch {
      return json({ error: 'Invalid token request.' }, 400)
    }
  }
  try {
    const auth = createAuth(bindings, url.origin)
    const session = await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    })
    forwardCookies(session.headers, responseHeaders)
    if (!session.response)
      return sessionRequest
        ? json({ connected: false, configured: true })
        : reconnect()
    const accounts = await auth.api.listUserAccounts({
      headers: request.headers,
      returnHeaders: true,
    })
    forwardCookies(accounts.headers, responseHeaders)
    const account = accounts.response.find(
      (item) =>
        item.providerId === 'google' && item.scopes.includes(driveScope),
    )
    if (sessionRequest)
      return json({
        connected: Boolean(account),
        configured: true,
        accountId: account?.accountId,
      })
    if (!account) return reconnect()
    const tokens = await auth.api[
      forceRefresh ? 'refreshToken' : 'getAccessToken'
    ]({
      headers: request.headers,
      body: { accountId: account.id },
      returnHeaders: true,
    })
    forwardCookies(tokens.headers, responseHeaders)
    const { accessToken, accessTokenExpiresAt } = tokens.response
    const expiresAt =
      accessTokenExpiresAt instanceof Date
        ? accessTokenExpiresAt.getTime()
        : typeof accessTokenExpiresAt === 'string' ||
            typeof accessTokenExpiresAt === 'number'
          ? new Date(accessTokenExpiresAt).getTime()
          : undefined
    if (
      !accessToken ||
      !expiresAt ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      return reconnect()
    return json({ accessToken, expiresAt })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'headers' in error &&
      error.headers instanceof Headers
    )
      forwardCookies(error.headers, responseHeaders)
    if (authFailure(error))
      return sessionRequest
        ? json({ connected: false, configured: true })
        : reconnect()
    console.error('Drive token request failed', {
      name:
        error instanceof TypeError
          ? 'TypeError'
          : error instanceof Error
            ? 'Error'
            : 'AuthApiError',
    })
    return json({ error: 'Google Drive is temporarily unavailable.' }, 500)
  }
}
