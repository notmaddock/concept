import { env } from '#/env'

const scope = 'https://www.googleapis.com/auth/drive.file'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

interface GoogleOAuth {
  initTokenClient: (config: {
    client_id: string
    scope: string
    include_granted_scopes: boolean
    callback: (response: TokenResponse) => void
    error_callback: (error: { type: string }) => void
  }) => { requestAccessToken: () => void }
}

function oauth(): GoogleOAuth | undefined {
  return (
    window as Window & {
      google?: { accounts?: { oauth2?: GoogleOAuth } }
    }
  ).google?.accounts?.oauth2
}

export class GoogleDriveAuthError extends Error {
  constructor(message = 'Reconnect Google Drive') {
    super(message)
    this.name = 'GoogleDriveAuthError'
  }
}

export function isGoogleDriveAuthError(error: unknown) {
  return error instanceof Error && error.name === 'GoogleDriveAuthError'
}

interface AuthState {
  token?: { value: string; expiresAt: number }
  loading?: Promise<void>
  connecting?: Promise<string>
  expiryTimer?: ReturnType<typeof setTimeout>
  cancelConnection?: () => void
  connectionRevision: number
  listeners: Set<() => void>
}

// Keep credentials in this page's memory while development replaces modules.
const state: AuthState = (import.meta.hot?.data.driveAuth as
  AuthState | undefined) ?? {
  connectionRevision: 0,
  listeners: new Set(),
}
if (import.meta.hot) import.meta.hot.data.driveAuth = state

function notify() {
  for (const listener of state.listeners) listener()
}

export function subscribeGoogleDriveAuth(listener: () => void) {
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}

export function isGoogleDriveConnected() {
  return Boolean(state.token && Date.now() < state.token.expiresAt)
}

export function isGoogleDriveConfigured() {
  return Boolean(env.VITE_GOOGLE_CLIENT_ID)
}

export function getGoogleDriveToken(): string {
  if (!state.token || Date.now() >= state.token.expiresAt) {
    invalidateGoogleDriveToken()
    throw new GoogleDriveAuthError()
  }
  return state.token.value
}

export function invalidateGoogleDriveToken(expectedToken?: string) {
  if (expectedToken && state.token?.value !== expectedToken) return
  clearTimeout(state.expiryTimer)
  state.expiryTimer = undefined
  const wasConnected = Boolean(state.token)
  state.token = undefined
  if (wasConnected) notify()
}

export function disconnectGoogleDrive() {
  ++state.connectionRevision
  state.cancelConnection?.()
  state.connecting = undefined
  invalidateGoogleDriveToken()
}

export function prepareGoogleDriveAuth(): Promise<void> {
  if (oauth()) return Promise.resolve()
  if (state.loading) return state.loading
  state.loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timeout = setTimeout(() => finish(false), 15000)
    const finish = (loaded: boolean) => {
      clearTimeout(timeout)
      script.onload = null
      script.onerror = null
      if (loaded && oauth()) resolve()
      else {
        script.remove()
        state.loading = undefined
        reject(new Error('Could not load Google sign-in. Try again.'))
      }
    }
    script.onload = () => finish(true)
    script.onerror = () => finish(false)
    document.head.append(script)
  })
  return state.loading
}

// Call only from a user action; background sync must never open an OAuth popup.
export function connectGoogleDrive(): Promise<string> {
  if (state.connecting) return state.connecting
  const clientId = env.VITE_GOOGLE_CLIENT_ID
  if (!clientId)
    return Promise.reject(new Error('Google Drive is not configured.'))
  const revision = state.connectionRevision
  const connection = prepareGoogleDriveAuth()
    .then(
      () =>
        new Promise<string>((resolve, reject) => {
          let completed = false
          const finish = () => {
            if (completed) return false
            completed = true
            clearTimeout(timeout)
            if (state.cancelConnection === cancel)
              state.cancelConnection = undefined
            return true
          }
          const fail = (error: Error) => {
            if (finish()) reject(error)
          }
          const cancel = () =>
            fail(
              new GoogleDriveAuthError(
                'Google Drive connection was cancelled.',
              ),
            )
          const timeout = setTimeout(
            () =>
              fail(
                new GoogleDriveAuthError(
                  'Google sign-in did not finish. Close its window and try again.',
                ),
              ),
            120000,
          )
          state.cancelConnection = cancel
          if (revision !== state.connectionRevision) {
            cancel()
            return
          }
          const api = oauth()
          if (!api) {
            fail(new Error('Google sign-in is unavailable. Try again.'))
            return
          }
          try {
            api
              .initTokenClient({
                client_id: clientId,
                scope,
                include_granted_scopes: false,
                callback: (response) => {
                  if (completed) return
                  if (revision !== state.connectionRevision) {
                    cancel()
                    return
                  }
                  const expiresIn = Number(response.expires_in)
                  if (
                    response.error ||
                    !response.access_token ||
                    !Number.isFinite(expiresIn) ||
                    expiresIn <= 30 ||
                    !response.scope?.split(' ').includes(scope)
                  ) {
                    fail(
                      new GoogleDriveAuthError(
                        'Google Drive access was not granted.',
                      ),
                    )
                    return
                  }
                  state.token = {
                    value: response.access_token,
                    expiresAt: Date.now() + (expiresIn - 30) * 1000,
                  }
                  clearTimeout(state.expiryTimer)
                  state.expiryTimer = setTimeout(
                    invalidateGoogleDriveToken,
                    expiresIn * 1000 - 30000,
                  )
                  notify()
                  if (finish()) resolve(response.access_token)
                },
                error_callback: ({ type }) =>
                  fail(
                    new GoogleDriveAuthError(
                      type === 'popup_closed'
                        ? 'Google sign-in was closed.'
                        : 'Could not open Google sign-in. Try again.',
                    ),
                  ),
              })
              .requestAccessToken()
          } catch (error) {
            fail(
              error instanceof Error
                ? error
                : new Error('Google sign-in failed. Try again.'),
            )
          }
        }),
    )
    .finally(() => {
      if (state.connecting === connection) state.connecting = undefined
    })
  state.connecting = connection
  return state.connecting
}
