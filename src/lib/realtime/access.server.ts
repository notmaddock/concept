import { createAuth } from '#/lib/auth.server'

export const grantLifetimeMs = 60_000
const driveScope = 'https://www.googleapis.com/auth/drive.file'

export class AccessFailure extends Error {
  constructor(public readonly status: number) {
    super('Document access could not be verified.')
  }
}

export function parseResource(url: URL) {
  const fileId = url.searchParams.get('fileId') ?? ''
  const resourceKey = url.searchParams.get('resourceKey') ?? undefined
  if (
    !/^[\w-]{1,256}$/.test(fileId) ||
    (resourceKey && !/^[\w-]{1,256}$/.test(resourceKey))
  )
    throw new AccessFailure(400)
  return { fileId, resourceKey }
}

export async function getIdentity(request: Request, bindings: Cloudflare.Env) {
  const auth = createAuth(bindings, new URL(request.url).origin)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw new AccessFailure(401)
  const accounts = await auth.api.listUserAccounts({ headers: request.headers })
  const account = accounts.find(
    (item) => item.providerId === 'google' && item.scopes.includes(driveScope),
  )
  if (!account) throw new AccessFailure(401)
  return {
    auth,
    accountId: account.accountId,
    internalAccountId: account.id,
    userId: session.user.id,
  }
}

export type RealtimeGrant = {
  userId: string
  accountId: string
  readOnly: boolean
  expiresAt: number
  publicAccess?: boolean
}

export async function checkDriveAccess(
  request: Request,
  identity: Awaited<ReturnType<typeof getIdentity>>,
  resource: ReturnType<typeof parseResource>,
): Promise<RealtimeGrant> {
  const startedAt = Date.now()
  const tokens = await identity.auth.api.getAccessToken({
    headers: request.headers,
    body: { accountId: identity.internalAccountId },
  })
  if (!tokens.accessToken) throw new AccessFailure(401)
  const headers = new Headers({ Authorization: `Bearer ${tokens.accessToken}` })
  if (resource.resourceKey)
    headers.set(
      'X-Goog-Drive-Resource-Keys',
      `${resource.fileId}/${resource.resourceKey}`,
    )
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resource.fileId)}`,
  )
  url.searchParams.set('supportsAllDrives', 'true')
  url.searchParams.set(
    'fields',
    'id,trashed,mimeType,capabilities(canDownload,canEdit,canModifyContent)',
  )
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    // A generic 403 can also mean quota exhaustion, so never call it revocation.
    throw new AccessFailure(
      response.status === 404 ? 404 : response.status === 401 ? 401 : 503,
    )
  }
  const file: unknown = await response.json()
  if (
    !file ||
    typeof file !== 'object' ||
    !('id' in file) ||
    file.id !== resource.fileId
  )
    throw new AccessFailure(503)
  if ('trashed' in file && file.trashed === true) throw new AccessFailure(404)
  const capabilities = 'capabilities' in file ? file.capabilities : undefined
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    !('canDownload' in capabilities) ||
    capabilities.canDownload !== true
  )
    throw new AccessFailure(403)
  const readOnly = !(
    'canEdit' in capabilities &&
    capabilities.canEdit === true &&
    'canModifyContent' in capabilities &&
    capabilities.canModifyContent === true
  )
  const expiresAt = startedAt + grantLifetimeMs
  if (expiresAt <= Date.now()) throw new AccessFailure(503)
  return {
    userId: identity.userId,
    accountId: identity.accountId,
    readOnly,
    expiresAt,
  }
}
