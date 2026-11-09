import { createAuth } from '#/lib/auth.server'
import type { ServerAuth } from '#/lib/auth.server'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export function forwardCookies(source: Headers, target: Headers) {
  for (const cookie of source.getSetCookie()) {
    target.append('Set-Cookie', cookie)
  }
}

export interface GoogleDriveAccountResolution {
  auth: ServerAuth
  session: { user: { id: string } } | null
  account: { id: string; providerId: string; scopes: string[] } | null
}

/**
 * Resolves the authenticated better-auth session and the associated Google Drive account.
 * Appends Set-Cookie headers from both session and account responses to responseHeaders.
 */
export async function resolveGoogleDriveAccount(
  request: Request,
  bindings: Cloudflare.Env,
  origin: string,
  responseHeaders: Headers,
): Promise<GoogleDriveAccountResolution> {
  const auth = createAuth(bindings, origin)
  const session = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  })
  forwardCookies(session.headers, responseHeaders)

  if (!session.response) {
    return { auth, session: null, account: null }
  }

  const accounts = await auth.api.listUserAccounts({
    headers: request.headers,
    returnHeaders: true,
  })
  forwardCookies(accounts.headers, responseHeaders)

  const account =
    accounts.response.find(
      (item) =>
        item.providerId === 'google' && item.scopes.includes(DRIVE_SCOPE),
    ) ?? null

  return { auth, session: session.response, account }
}
