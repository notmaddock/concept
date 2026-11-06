import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleDriveToken } from './token.server'

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn(),
  getSession: vi.fn(),
  listUserAccounts: vi.fn(),
  getAccessToken: vi.fn(),
  refreshToken: vi.fn(),
}))
vi.mock('#/lib/auth.server', () => ({ createAuth: mocks.createAuth }))

const origin = 'https://concept.example.com'
const scope = 'https://www.googleapis.com/auth/drive.file'
const expiresAt = Date.now() + 3_600_000
const bindings = Object.assign({} as Cloudflare.Env, {
  DB: {},
  BETTER_AUTH_SECRET: 'test-session-secret',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  AUTH_TRUSTED_ORIGINS: origin,
  OAUTH_PROXY_URL: origin,
  OAUTH_PROXY_SECRET: 'test-proxy-secret',
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.createAuth.mockReturnValue({
    api: {
      getSession: mocks.getSession,
      listUserAccounts: mocks.listUserAccounts,
      getAccessToken: mocks.getAccessToken,
      refreshToken: mocks.refreshToken,
    },
  })
  mocks.getSession.mockResolvedValue({
    headers: new Headers(),
    response: {
      user: { id: 'private-user-id' },
      session: { token: 'private-session-token' },
    },
  })
  mocks.listUserAccounts.mockResolvedValue({
    headers: new Headers(),
    response: [
      {
        id: 'local-account-id',
        providerId: 'google',
        accountId: 'provider-account-id',
        scopes: [scope],
      },
    ],
  })
  const tokens = {
    headers: new Headers(),
    response: {
      accessToken: 'browser-access-token',
      accessTokenExpiresAt: new Date(expiresAt),
      refreshToken: 'server-only-refresh-token',
      idToken: 'server-only-id-token',
      scopes: [scope],
    },
  }
  mocks.getAccessToken.mockResolvedValue(tokens)
  mocks.refreshToken.mockResolvedValue(tokens)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function request(path = 'token', init: RequestInit = {}) {
  return new Request(`${origin}/api/drive/${path}`, {
    method: path === 'session' ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...init,
  })
}

it('returns only connection status without fetching or refreshing tokens', async () => {
  const response = await handleDriveToken(request('session'), bindings)
  expect(await response.json()).toEqual({
    connected: true,
    configured: true,
    accountId: 'provider-account-id',
  })
  expect(mocks.getAccessToken).not.toHaveBeenCalled()
  expect(mocks.refreshToken).not.toHaveBeenCalled()
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
})

it('returns only the access token and epoch expiry for the session-selected Google account', async () => {
  const input = request()
  const response = await handleDriveToken(input, bindings)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    accessToken: 'browser-access-token',
    expiresAt,
  })
  expect(mocks.getAccessToken).toHaveBeenCalledWith({
    headers: input.headers,
    body: { accountId: 'local-account-id' },
    returnHeaders: true,
  })
  expect(mocks.refreshToken).not.toHaveBeenCalled()
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Vary')).toBe('Cookie')
})

it('forces a server-side refresh without returning refresh or ID tokens', async () => {
  mocks.getSession.mockResolvedValue({
    headers: new Headers({ 'Set-Cookie': 'session=renewed; HttpOnly; Secure' }),
    response: { user: { id: 'private-user' } },
  })
  mocks.refreshToken.mockResolvedValue({
    headers: new Headers({ 'Set-Cookie': 'account=renewed; HttpOnly; Secure' }),
    response: {
      accessToken: 'fresh-browser-token',
      accessTokenExpiresAt: new Date(expiresAt),
      refreshToken: 'private-refresh',
      idToken: 'private-id',
      providerId: 'google',
      accountId: 'private-account',
    },
  })
  const input = request('token', {
    body: JSON.stringify({ forceRefresh: true }),
  })
  const response = await handleDriveToken(input, bindings)
  expect(await response.json()).toEqual({
    accessToken: 'fresh-browser-token',
    expiresAt,
  })
  expect(mocks.refreshToken).toHaveBeenCalledWith({
    headers: input.headers,
    body: { accountId: 'local-account-id' },
    returnHeaders: true,
  })
  expect(mocks.getAccessToken).not.toHaveBeenCalled()
  expect(response.headers.getSetCookie()).toEqual([
    'session=renewed; HttpOnly; Secure',
    'account=renewed; HttpOnly; Secure',
  ])
})

it('returns disconnected status and denies token requests without a session', async () => {
  mocks.getSession.mockResolvedValue({ headers: new Headers(), response: null })
  const status = await handleDriveToken(request('session'), bindings)
  expect(await status.json()).toEqual({ connected: false, configured: true })
  const token = await handleDriveToken(request(), bindings)
  expect(token.status).toBe(401)
  expect(mocks.listUserAccounts).not.toHaveBeenCalled()
  expect(mocks.getAccessToken).not.toHaveBeenCalled()
})

it.each([
  { accounts: [] },
  { accounts: [{ id: 'other', providerId: 'github', scopes: [scope] }] },
  { accounts: [{ id: 'google', providerId: 'google', scopes: ['openid'] }] },
])('requires a scoped Google account: %j', async ({ accounts }) => {
  mocks.listUserAccounts.mockResolvedValue({
    headers: new Headers(),
    response: accounts,
  })
  const response = await handleDriveToken(request(), bindings)
  expect(response.status).toBe(401)
  expect(mocks.getAccessToken).not.toHaveBeenCalled()
  expect(mocks.refreshToken).not.toHaveBeenCalled()
})

it.each([undefined, 'https://evil.example'])(
  'requires exact same-origin token requests: %s',
  async (requestOrigin) => {
    const headers = new Headers()
    if (requestOrigin) headers.set('Origin', requestOrigin)
    const response = await handleDriveToken(
      request('token', { headers }),
      bindings,
    )
    expect(response.status).toBe(403)
    expect(mocks.createAuth).not.toHaveBeenCalled()
  },
)

it.each([
  ['unknown', 'GET', 404],
  ['token', 'GET', 405],
  ['session', 'POST', 405],
])(
  'rejects unknown paths and unsupported methods: %s %s',
  async (path, method, status) => {
    const response = await handleDriveToken(request(path, { method }), bindings)
    expect(response.status).toBe(status)
    expect(mocks.createAuth).not.toHaveBeenCalled()
  },
)

it.each([
  'not-json',
  '{"forceRefresh":"true"}',
  '{"accountId":"another-user-account"}',
  '[]',
])('rejects malformed token options: %s', async (body) => {
  const response = await handleDriveToken(request('token', { body }), bindings)
  expect(response.status).toBe(400)
  expect(mocks.createAuth).not.toHaveBeenCalled()
})

it('reports unconfigured servers without starting auth', async () => {
  const missing = { ...bindings, GOOGLE_CLIENT_SECRET: '' }
  const status = await handleDriveToken(request('session'), missing)
  expect(status.status).toBe(503)
  expect(await status.json()).toEqual({ connected: false, configured: false })
  expect((await handleDriveToken(request(), missing)).status).toBe(503)
  expect(mocks.createAuth).not.toHaveBeenCalled()
})

it.each(['FAILED_TO_GET_ACCESS_TOKEN', 'FAILED_TO_REFRESH_ACCESS_TOKEN'])(
  'keeps collapsed refresh failures retryable: %s',
  async (code) => {
    mocks.getAccessToken.mockRejectedValue({
      statusCode: 400,
      body: { code, message: 'private refresh detail' },
    })
    const response = await handleDriveToken(request(), bindings)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Google Drive is temporarily unavailable.',
    })
  },
)

it('requires reconnection for explicitly missing refresh credentials', async () => {
  mocks.refreshToken.mockRejectedValue({
    statusCode: 400,
    body: {
      code: 'REFRESH_TOKEN_NOT_FOUND',
      message: 'private account detail',
    },
  })
  const response = await handleDriveToken(
    request('token', { body: '{"forceRefresh":true}' }),
    bindings,
  )
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'Reconnect Google Drive.' })
})

it('records a safe diagnostic for unexpected failures without logging credentials', async () => {
  mocks.getAccessToken.mockRejectedValue(
    new TypeError('private-refresh-token must stay private'),
  )
  const response = await handleDriveToken(request(), bindings)
  expect(response.status).toBe(500)
  expect(console.error).toHaveBeenCalledWith('Drive token request failed', {
    name: 'TypeError',
  })
  expect(await response.json()).toEqual({
    error: 'Google Drive is temporarily unavailable.',
  })
})
