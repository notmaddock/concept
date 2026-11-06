import { createAuthClient } from 'better-auth/client'

const authClient = createAuthClient()
type SessionState = {
  connected: boolean
  configured: boolean
  revision: number
  loading?: Promise<void>
  listeners: Set<() => void>
}
const hot = import.meta.hot?.data as { driveSession?: SessionState } | undefined
const state: SessionState = hot?.driveSession ?? {
  connected: false,
  configured: true,
  revision: 0,
  listeners: new Set(),
}
if (hot) hot.driveSession = state

let token: { value: string; expiresAt: number } | undefined
let tokenRequest:
  { promise: Promise<string>; forceRefresh: boolean } | undefined
let refreshRequired = false

function clearToken() {
  token = undefined
  tokenRequest = undefined
  refreshRequired = false
}

export class GoogleDriveAuthError extends Error {
  constructor(message = 'Reconnect Google Drive') {
    super(message)
    this.name = 'GoogleDriveAuthError'
  }
}

export const isGoogleDriveAuthError = (error: unknown) =>
  error instanceof GoogleDriveAuthError
export const isGoogleDriveConnected = () => state.connected
export const isGoogleDriveConfigured = () => state.configured

export interface SessionProfile {
  name?: string
  image?: string
}

let sessionProfile: Promise<SessionProfile | undefined> | undefined

/** Display identity for collaboration presence; failures leave it anonymous. */
export function getSessionProfile(): Promise<SessionProfile | undefined> {
  sessionProfile ??= authClient
    .getSession()
    .then((result) => {
      const user = result.data?.user
      if (!user) return undefined
      return {
        name: user.name || undefined,
        image: user.image || undefined,
      }
    })
    .catch(() => undefined)
  return sessionProfile
}

export function subscribeGoogleDriveAuth(listener: () => void) {
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}
function notify() {
  state.listeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // Isolate listener exceptions
    }
  })
}

export function invalidateGoogleDriveSession() {
  ++state.revision
  clearToken()
  state.connected = false
  notify()
}

export function prepareGoogleDriveAuth(): Promise<void> {
  if (state.loading) return state.loading
  const revision = state.revision
  state.loading = fetch('/api/drive/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
    .then(async (response) => {
      if (response.status !== 503 && !response.ok)
        throw new Error('Could not check the Google Drive connection.')
      const data = (await response.json()) as {
        connected?: unknown
        configured?: unknown
      }
      if (
        typeof data.connected !== 'boolean' ||
        typeof data.configured !== 'boolean'
      )
        throw new Error('Could not check the Google Drive connection.')
      if (revision !== state.revision) return
      state.connected = data.connected
      state.configured = data.configured
      if (!data.connected) {
        ++state.revision
        clearToken()
      }
      notify()
    })
    .finally(() => {
      state.loading = undefined
    })
  return state.loading
}

export async function connectGoogleDrive() {
  const result = await authClient.signIn.social({
    provider: 'google',
    callbackURL: window.location.href,
  })
  if (result.error)
    throw new GoogleDriveAuthError(
      result.error.message || 'Could not connect Google Drive.',
    )
}

export async function disconnectGoogleDrive() {
  ++state.revision
  clearToken()
  const result = await authClient.signOut()
  if (result.error)
    throw new Error(
      result.error.message || 'Could not disconnect Google Drive.',
    )
  invalidateGoogleDriveSession()
}

function waitForToken(promise: Promise<string>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export function getGoogleDriveToken({
  forceRefresh = false,
  signal,
}: {
  forceRefresh?: boolean
  signal?: AbortSignal
} = {}): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (forceRefresh) refreshRequired = true
  if (tokenRequest) {
    const pending =
      forceRefresh && !tokenRequest.forceRefresh
        ? tokenRequest.promise
            .catch(() => {})
            .then(() => getGoogleDriveToken({ forceRefresh: true, signal }))
        : tokenRequest.promise
    return waitForToken(pending, signal)
  }
  if (!refreshRequired && token && token.expiresAt > Date.now() + 60000)
    return Promise.resolve(token.value)
  const refresh = refreshRequired || Boolean(token)
  const revision = state.revision
  const promise = fetch('/api/drive/token', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refresh ? { forceRefresh: true } : {}),
    signal: AbortSignal.timeout(15000),
  })
    .then(async (response) => {
      if (revision !== state.revision) throw new GoogleDriveAuthError()
      if (response.status === 401) {
        invalidateGoogleDriveSession()
        throw new GoogleDriveAuthError()
      }
      if (!response.ok)
        throw new Error('Google Drive is temporarily unavailable.')
      const data = (await response.json()) as {
        accessToken?: unknown
        expiresAt?: unknown
      }
      if (revision !== state.revision) throw new GoogleDriveAuthError()
      if (
        typeof data.accessToken !== 'string' ||
        !data.accessToken ||
        typeof data.expiresAt !== 'number' ||
        !Number.isFinite(data.expiresAt) ||
        data.expiresAt <= Date.now()
      )
        throw new Error('Could not obtain a valid Google Drive access token.')
      token = { value: data.accessToken, expiresAt: data.expiresAt }
      refreshRequired = false
      state.configured = true
      if (!state.connected) {
        state.connected = true
        notify()
      }
      return token.value
    })
    .finally(() => {
      if (tokenRequest?.promise === promise) tokenRequest = undefined
    })
  tokenRequest = { promise, forceRefresh: refresh }
  return waitForToken(promise, signal)
}
