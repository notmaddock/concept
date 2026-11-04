import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ social: vi.fn(), signOut: vi.fn() }))
vi.mock('better-auth/client', () => ({
  createAuthClient: () => ({
    signIn: { social: sdk.social },
    signOut: sdk.signOut,
  }),
}))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  sdk.social.mockResolvedValue({ error: null })
  sdk.signOut.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function session(connected = true, configured = true, status = 200) {
  return new Response(JSON.stringify({ connected, configured }), { status })
}

function brokerToken(
  value = 'google-access-token',
  expiresAt = Date.now() + 3600000,
) {
  return new Response(JSON.stringify({ accessToken: value, expiresAt }))
}

it('deduplicates token acquisition and caches credentials only in module memory', async () => {
  const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
  fetchMock.mockResolvedValueOnce(brokerToken())
  const auth = await import('./auth')
  const [first, second] = await Promise.all([
    auth.getGoogleDriveToken(),
    auth.getGoogleDriveToken(),
  ])
  expect(first).toBe('google-access-token')
  expect(second).toBe(first)
  await expect(auth.getGoogleDriveToken()).resolves.toBe(first)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/drive/token',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: '{}',
    }),
  )
  expect(writeStorage).not.toHaveBeenCalled()
  expect(sdk.social).not.toHaveBeenCalled()
})

it('refreshes within sixty seconds of token expiry', async () => {
  vi.useFakeTimers()
  fetchMock.mockResolvedValueOnce(brokerToken('old-token', Date.now() + 120000))
  const auth = await import('./auth')
  await auth.getGoogleDriveToken()
  vi.advanceTimersByTime(60000)
  fetchMock.mockResolvedValueOnce(brokerToken('new-token'))
  await expect(auth.getGoogleDriveToken()).resolves.toBe('new-token')
  expect(fetchMock.mock.calls[1][1]?.body).toBe('{"forceRefresh":true}')
})

it('shares forced refreshes with concurrent token consumers', async () => {
  fetchMock.mockResolvedValueOnce(brokerToken('old-token'))
  const auth = await import('./auth')
  await auth.getGoogleDriveToken()
  fetchMock.mockResolvedValueOnce(brokerToken('new-token'))
  const values = await Promise.all([
    auth.getGoogleDriveToken({ forceRefresh: true }),
    auth.getGoogleDriveToken({ forceRefresh: true }),
    auth.getGoogleDriveToken(),
  ])
  expect(values).toEqual(['new-token', 'new-token', 'new-token'])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('never returns a broker response received after disconnect', async () => {
  let resolveToken: (response: Response) => void = () => {}
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveToken = resolve
    }),
  )
  const auth = await import('./auth')
  const pending = auth.getGoogleDriveToken()
  await auth.disconnectGoogleDrive()
  const rejected = expect(pending).rejects.toBeInstanceOf(
    auth.GoogleDriveAuthError,
  )
  resolveToken(brokerToken('stale-token'))
  await rejected
  expect(auth.isGoogleDriveConnected()).toBe(false)
  fetchMock.mockResolvedValueOnce(brokerToken('new-session-token'))
  await expect(auth.getGoogleDriveToken()).resolves.toBe('new-session-token')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('cancels an individual waiter without cancelling another document token request', async () => {
  let resolveToken: (response: Response) => void = () => {}
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveToken = resolve
    }),
  )
  const auth = await import('./auth')
  const controller = new AbortController()
  const first = auth.getGoogleDriveToken({ signal: controller.signal })
  const second = auth.getGoogleDriveToken()
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
  resolveToken(brokerToken())
  await expect(second).resolves.toBe('google-access-token')
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('keeps forced refresh retryable after a temporary broker failure', async () => {
  fetchMock.mockResolvedValueOnce(brokerToken('old-token'))
  const auth = await import('./auth')
  await auth.getGoogleDriveToken()
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(
    auth.getGoogleDriveToken({ forceRefresh: true }),
  ).rejects.toThrow('temporarily unavailable')
  expect(auth.isGoogleDriveConnected()).toBe(true)
  fetchMock.mockResolvedValueOnce(brokerToken('new-token'))
  await expect(auth.getGoogleDriveToken()).resolves.toBe('new-token')
  expect(fetchMock.mock.calls[2][1]?.body).toBe('{"forceRefresh":true}')
})

it('clears credentials when the broker reports an expired app session', async () => {
  fetchMock.mockResolvedValueOnce(brokerToken())
  const auth = await import('./auth')
  await auth.getGoogleDriveToken()
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
  await expect(
    auth.getGoogleDriveToken({ forceRefresh: true }),
  ).rejects.toBeInstanceOf(auth.GoogleDriveAuthError)
  expect(auth.isGoogleDriveConnected()).toBe(false)
  expect(sdk.social).not.toHaveBeenCalled()
})

it('restores the cookie-backed connection without signing in or storing Google credentials', async () => {
  const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
  fetchMock.mockResolvedValueOnce(session())
  const auth = await import('./auth')
  const changed = vi.fn()
  const unsubscribe = auth.subscribeGoogleDriveAuth(changed)
  await auth.prepareGoogleDriveAuth()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/drive/session',
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }),
  )
  expect(auth.isGoogleDriveConnected()).toBe(true)
  expect(changed).toHaveBeenCalledOnce()
  expect(sdk.social).not.toHaveBeenCalled()
  expect(writeStorage).not.toHaveBeenCalled()
  unsubscribe()
  writeStorage.mockRestore()
})

it('deduplicates session checks and reports missing server configuration', async () => {
  fetchMock.mockResolvedValueOnce(session(false, false, 503))
  const auth = await import('./auth')
  const first = auth.prepareGoogleDriveAuth()
  expect(auth.prepareGoogleDriveAuth()).toBe(first)
  await first
  expect(auth.isGoogleDriveConfigured()).toBe(false)
  expect(auth.isGoogleDriveConnected()).toBe(false)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(sdk.social).not.toHaveBeenCalled()
})

it('ignores a session response started before disconnect', async () => {
  let resolveSession: (response: Response) => void = () => {}
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSession = resolve
    }),
  )
  const auth = await import('./auth')
  const check = auth.prepareGoogleDriveAuth()
  await auth.disconnectGoogleDrive()
  resolveSession(session())
  await check
  expect(auth.isGoogleDriveConnected()).toBe(false)
  expect(sdk.signOut).toHaveBeenCalledOnce()
  expect(sdk.social).not.toHaveBeenCalled()
})

it('returns to the current document hash after the explicit Google sign-in', async () => {
  const originalURL = window.location.href
  window.history.replaceState(null, '', '/#Gdrive-file')
  try {
    const auth = await import('./auth')
    await auth.connectGoogleDrive()
    expect(sdk.social).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: window.location.href,
    })
    expect(sdk.social.mock.calls[0][0].callbackURL).toContain('#Gdrive-file')
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    window.history.replaceState(null, '', originalURL)
  }
})

it('surfaces sign-in errors without marking Drive connected', async () => {
  sdk.social.mockResolvedValueOnce({
    error: { message: 'Google authorization failed.' },
  })
  const auth = await import('./auth')
  await expect(auth.connectGoogleDrive()).rejects.toThrow(
    'Google authorization failed.',
  )
  expect(auth.isGoogleDriveConnected()).toBe(false)
})

it('preserves the connection when sign-out fails and surfaces the error', async () => {
  fetchMock.mockResolvedValueOnce(session())
  const auth = await import('./auth')
  await auth.prepareGoogleDriveAuth()
  sdk.signOut.mockResolvedValueOnce({
    error: { message: 'Could not end the session.' },
  })
  await expect(auth.disconnectGoogleDrive()).rejects.toThrow(
    'Could not end the session.',
  )
  expect(auth.isGoogleDriveConnected()).toBe(true)
})

it('notifies on successful disconnect and allows unsubscribing', async () => {
  fetchMock.mockResolvedValueOnce(session())
  const auth = await import('./auth')
  await auth.prepareGoogleDriveAuth()
  const states: Array<boolean> = []
  const unsubscribe = auth.subscribeGoogleDriveAuth(() =>
    states.push(auth.isGoogleDriveConnected()),
  )
  await auth.disconnectGoogleDrive()
  expect(states).toEqual([false])
  unsubscribe()
  auth.invalidateGoogleDriveSession()
  expect(states).toEqual([false])
})

it('keeps transient check failures retryable without launching Google sign-in', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(session(false))
  const auth = await import('./auth')
  await expect(auth.prepareGoogleDriveAuth()).rejects.toThrow('Could not check')
  await auth.prepareGoogleDriveAuth()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(sdk.social).not.toHaveBeenCalled()
})

it('rejects malformed server connection state', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ connected: 'yes', configured: true })),
  )
  const auth = await import('./auth')
  await expect(auth.prepareGoogleDriveAuth()).rejects.toThrow('Could not check')
  expect(auth.isGoogleDriveConnected()).toBe(false)
})
