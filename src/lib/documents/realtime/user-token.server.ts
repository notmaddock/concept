import { createAuth } from '#/lib/auth.server'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'

/** Account row as returned by better-auth's internal adapter. */
interface StoredAccount {
  id: string
  providerId: string
  scope?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  accessTokenExpiresAt?: Date | null
}

/**
 * Structural view of better-auth's internal adapter. The runtime API is not
 * part of the public `AuthContext` type, so we reach it through a cast.
 */
interface InternalAdapterLike {
  findAccounts: (userId: string) => Promise<StoredAccount[]>
  updateAccount: (id: string, data: Partial<StoredAccount>) => Promise<unknown>
}

interface AuthLike {
  $context: Promise<{ internalAdapter: InternalAdapterLike }>
}

interface CachedToken {
  token: string
  expiresAt: number
}

/** Per-user access tokens, reused until expiry (refreshed only on expiry/401). */
const tokenCache = new Map<string, CachedToken>()

/** Drops the cached token so the next call refreshes (used after a 401). */
export function clearCachedDriveTokenForUser(userId: string): void {
  tokenCache.delete(userId)
}

function expiryOf(account: StoredAccount): number {
  return account.accessTokenExpiresAt
    ? new Date(account.accessTokenExpiresAt).getTime()
    : 0
}

async function refreshDriveAccessToken(
  bindings: Cloudflare.Env,
  refreshToken: string,
): Promise<CachedToken> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: bindings.GOOGLE_CLIENT_ID,
      client_secret: bindings.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })
  if (!response.ok)
    throw new Error(
      `Failed to refresh Google access token (${response.status}).`,
    )
  const body = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!body.access_token)
    throw new Error('Google token refresh returned no access token.')
  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
}

/**
 * Returns a valid Google Drive access token for the user, decrypting the
 * stored OAuth tokens (better-auth runs with `encryptOAuthTokens`) and
 * refreshing via the refresh token only when the access token is expired.
 * Tokens are cached per user and reused until expiry.
 */
export async function getDriveAccessTokenForUser(
  bindings: Cloudflare.Env,
  origin: string,
  userId: string,
): Promise<string> {
  const cached = tokenCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.token
  const auth = createAuth(bindings, origin)
  const ctx = await (auth as unknown as AuthLike).$context
  const internalAdapter = ctx.internalAdapter
  const accounts = await internalAdapter.findAccounts(userId)
  const account = accounts.find(
    (item) =>
      item.providerId === 'google' && (item.scope ?? '').includes(driveScope),
  )
  if (!account) throw new Error('User has no Google account with Drive scope.')
  const key = bindings.BETTER_AUTH_SECRET
  if (account.accessToken && expiryOf(account) > Date.now()) {
    const token = await symmetricDecrypt({ key, data: account.accessToken })
    tokenCache.set(userId, { token, expiresAt: expiryOf(account) })
    return token
  }
  if (!account.refreshToken)
    throw new Error('User has no Google refresh token.')
  const refreshToken = await symmetricDecrypt({
    key,
    data: account.refreshToken,
  })
  const refreshed = await refreshDriveAccessToken(bindings, refreshToken)
  await internalAdapter.updateAccount(account.id, {
    accessToken: await symmetricEncrypt({ key, data: refreshed.token }),
    accessTokenExpiresAt: new Date(refreshed.expiresAt),
  })
  tokenCache.set(userId, refreshed)
  return refreshed.token
}
