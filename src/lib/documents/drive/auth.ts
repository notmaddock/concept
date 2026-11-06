import { createAuthClient } from 'better-auth/client'

const offlineAccountKey = 'concept-drive-offline-account'
function readOfflineAccount() {
  try {
    return localStorage.getItem(offlineAccountKey) ?? undefined
  } catch {
    return undefined
  }
}
function rememberOfflineAccount(accountId?: string) {
  try {
    if (accountId) localStorage.setItem(offlineAccountKey, accountId)
    else localStorage.removeItem(offlineAccountKey)
  } catch {
    // Storage restrictions must not prevent an authenticated online session.
  }
}

const authClient = createAuthClient()
type SessionState = {
  connected: boolean
  accountId?: string
  configured: boolean
  revision: number
  checked?: boolean
  loading?: Promise<void>
  listeners: Set<() => void>
}
const hot = import.meta.hot?.data as { driveSession?: SessionState } | undefined
const state: SessionState = hot?.driveSession ?? {
  connected: false,
  accountId: readOfflineAccount(),
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
export const getGoogleDriveAccountId = () => state.accountId
export const isGoogleDriveConnected = () => state.connected
export const isGoogleDriveConfigured = () => state.configured
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

export async function settleGoogleDriveSession(): Promise<void> {
  if (!state.checked && !state.loading)
    await prepareGoogleDriveAuth().catch(() => {})
  else await state.loading?.catch(() => {})
}

export function prepareGoogleDriveAuth(): Promise<void> {
  if (state.loading) return state.loading
  state.checked = true
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
        accountId?: unknown
      }
      if (
        typeof data.connected !== 'boolean' ||
        typeof data.configured !== 'boolean'
      )
        throw new Error('Could not check the Google Drive connection.')
      if (revision !== state.revision) return
      const accountId =
        response.status === 503
          ? state.accountId
          : typeof data.accountId === 'string'
            ? data.accountId
            : undefined
      if (accountId !== state.accountId) {
        ++state.revision
        clearToken()
        state.accountId = accountId
        rememberOfflineAccount(accountId)
      }
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
  const cleanup = await fetch('/api/public-drive/disconnect', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!cleanup.ok)
    throw new Error(
      cleanup.status === 401
        ? 'Reconnect Google Drive before disconnecting its anonymous publishing access.'
        : 'Could not stop shared document publishing. Try disconnecting again.',
    )
  const result = await authClient.signOut()
  if (result.error)
    throw new Error(
      result.error.message || 'Could not disconnect Google Drive.',
    )
  state.accountId = undefined
  rememberOfflineAccount()
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
