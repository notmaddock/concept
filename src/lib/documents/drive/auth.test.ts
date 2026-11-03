import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('#/env', () => ({
  env: { VITE_GOOGLE_CLIENT_ID: 'test-client' },
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.head.querySelectorAll('script').forEach((script) => script.remove())
})

function googleClient() {
  let respond: (response: {
    access_token: string
    expires_in: number
    scope: string
  }) => void = () => {}
  const requestAccessToken = vi.fn()
  const initTokenClient = vi.fn((config: { callback: typeof respond }) => {
    respond = config.callback
    return { requestAccessToken }
  })
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
  return {
    initTokenClient,
    requestAccessToken,
    respond: (
      scope = 'https://www.googleapis.com/auth/drive.file',
      token = 'test-token',
    ) => respond({ access_token: token, expires_in: 3600, scope }),
  }
}

it('requires user reconnect after expiry and never opens a background popup', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  expect(() => auth.getGoogleDriveToken()).toThrow(auth.GoogleDriveAuthError)
  expect(client.requestAccessToken).not.toHaveBeenCalled()
  const connection = auth.connectGoogleDrive()
  await Promise.resolve()
  client.respond()
  await expect(connection).resolves.toBe('test-token')
  expect(auth.getGoogleDriveToken()).toBe('test-token')
  vi.advanceTimersByTime(3570000)
  expect(() => auth.getGoogleDriveToken()).toThrow(auth.GoogleDriveAuthError)
  expect(client.requestAccessToken).toHaveBeenCalledTimes(1)
})

it('deduplicates connection attempts and rejects missing Drive scope', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  const first = auth.connectGoogleDrive()
  expect(auth.connectGoogleDrive()).toBe(first)
  await Promise.resolve()
  client.respond('https://www.googleapis.com/auth/userinfo.email')
  await expect(first).rejects.toBeInstanceOf(auth.GoogleDriveAuthError)
  expect(() => auth.getGoogleDriveToken()).toThrow(auth.GoogleDriveAuthError)
  const retry = auth.connectGoogleDrive()
  await Promise.resolve()
  client.respond()
  await expect(retry).resolves.toBe('test-token')
})

it('allows retrying a failed script load', async () => {
  const auth = await import('./auth')
  const first = auth.prepareGoogleDriveAuth()
  const failed = document.head.querySelector('script')
  expect(failed?.src).toBe('https://accounts.google.com/gsi/client')
  failed?.dispatchEvent(new Event('error'))
  await expect(first).rejects.toThrow('Could not load Google sign-in')
  const retry = auth.prepareGoogleDriveAuth()
  const script = document.head.querySelector('script')
  expect(script).not.toBe(failed)
  googleClient()
  script?.dispatchEvent(new Event('load'))
  await expect(retry).resolves.toBeUndefined()
})

it('notifies subscribers on connect, disconnect, invalidation, and expiry', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  const states: Array<boolean> = []
  const unsubscribe = auth.subscribeGoogleDriveAuth(() =>
    states.push(auth.isGoogleDriveConnected()),
  )
  const connect = async () => {
    const connection = auth.connectGoogleDrive()
    await Promise.resolve()
    client.respond()
    await connection
  }
  await connect()
  auth.disconnectGoogleDrive()
  expect(auth.isGoogleDriveConnected()).toBe(false)
  expect(() => auth.getGoogleDriveToken()).toThrow(auth.GoogleDriveAuthError)
  await connect()
  auth.invalidateGoogleDriveToken()
  await connect()
  vi.advanceTimersByTime(3570000)
  expect(states).toEqual([true, false, true, false, true, false])
  unsubscribe()
  await connect()
  expect(states).toHaveLength(6)
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

it('does not restore a connection from an OAuth response received after disconnect', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  const connection = auth.connectGoogleDrive()
  await Promise.resolve()
  auth.disconnectGoogleDrive()
  client.respond()
  await expect(connection).rejects.toThrow('cancelled')
  expect(auth.isGoogleDriveConnected()).toBe(false)
})

it('ignores invalidation from a request using a superseded access token', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  const first = auth.connectGoogleDrive()
  await Promise.resolve()
  client.respond(undefined, 'old-token')
  await first
  const second = auth.connectGoogleDrive()
  await Promise.resolve()
  client.respond(undefined, 'new-token')
  await second
  auth.invalidateGoogleDriveToken('old-token')
  expect(auth.getGoogleDriveToken()).toBe('new-token')
  auth.invalidateGoogleDriveToken('new-token')
  expect(auth.isGoogleDriveConnected()).toBe(false)
})

it('releases a hung OAuth attempt so an explicit retry can start', async () => {
  const client = googleClient()
  const auth = await import('./auth')
  const pending = auth.connectGoogleDrive()
  await Promise.resolve()
  const rejected = expect(pending).rejects.toThrow('did not finish')
  vi.advanceTimersByTime(120000)
  await rejected
  const retry = auth.connectGoogleDrive()
  await Promise.resolve()
  client.respond()
  await expect(retry).resolves.toBe('test-token')
  expect(client.requestAccessToken).toHaveBeenCalledTimes(2)
})
