import { createAuth } from '#/lib/auth.server'
import { packageLimits } from '../limits'
import {
  AccessFailure,
  getIdentity,
  grantLifetimeMs,
  parseResource,
} from '#/lib/realtime/access.server'
import type { RealtimeGrant } from '#/lib/realtime/access.server'

const conceptMimeType = 'application/vnd.concept+zip'
const conceptMimeTypes = [conceptMimeType, 'application/vnd.concept+json']
const v2Fields =
  'id,title,mimeType,modifiedDate,fileSize,version,headRevisionId,etag,capabilities(canEdit,canModifyContent,canDownload,canComment,canCopy)'
const publicFields =
  'id,name,mimeType,trashed,resourceKey,linkShareMetadata(securityUpdateEnabled,securityUpdateEligible),inheritedPermissionsDisabled,contentRestrictions(readOnly),downloadRestrictions(effectiveDownloadRestrictionWithContext(restrictedForReaders,restrictedForWriters)),capabilities(canDownload,canEdit,canModifyContent)'
const cookieName = 'concept-anonymous'

class PublicAccessLost extends AccessFailure {}

type PolicyDenialReason =
  | 'resourceMismatch'
  | 'fileTrashed'
  | 'unsupportedPackageType'
  | 'resourceKeyRequired'
  | 'resourceKeyMismatch'
  | 'resourceKeyUnavailable'
  | 'publisherCannotDownload'
  | 'publisherCannotEdit'
  | 'publisherCannotModifyContent'
  | 'limitedAccessUnsupported'
  | 'publicPermissionMissing'
  | 'publicDownloadRestricted'
  | 'publicWritePermissionRequired'
  | 'contentReadOnly'

type PolicyObservation = ReturnType<typeof policyObservation>

class PublicPolicyFailure extends AccessFailure {
  constructor(
    status: number,
    public readonly denialReason: PolicyDenialReason,
    public readonly observation: PolicyObservation,
  ) {
    super(status)
  }
}

type RegistrationStage =
  | 'identity'
  | 'registry_read'
  | 'credentials'
  | 'metadata'
  | 'permissions'
  | 'policy'
  | 'registry_write'

class PublicDriveProviderFailure extends AccessFailure {
  constructor(
    public readonly stage: 'metadata' | 'permissions' | 'publication',
    public readonly providerStatus: number,
  ) {
    super([404, 412, 413].includes(providerStatus) ? providerStatus : 503)
  }
}

class PublisherRegistrationFailure extends AccessFailure {
  constructor(
    public readonly stage: RegistrationStage,
    status: number,
    public readonly providerStatus?: number,
    public readonly policy?: {
      reason: PolicyDenialReason
      observation: PolicyObservation
    },
  ) {
    super(status)
  }

  get code() {
    if (this.status === 401) return 'publisherAuthenticationRequired'
    if ([403, 404].includes(this.status)) return 'publicSharingNotEnabled'
    if (this.status === 409) return 'publisherConsentChanged'
    if (this.stage === 'registry_read' || this.stage === 'registry_write')
      return 'publisherRegistryUnavailable'
    if (this.stage === 'credentials') return 'publisherCredentialsUnavailable'
    if (this.stage === 'permissions') return 'publisherPermissionCheckFailed'
    return 'publisherRegistrationUnavailable'
  }
}

type Resource = { fileId: string; resourceKey?: string }
type Publisher = {
  fileId: string
  userId: string
  accountId: string
  resourceKey: string | null
  updatedAt: number
  consentVersion: number
}
type PublicFile = {
  id: string
  mimeType: string
  name?: string
  trashed?: boolean
  resourceKey?: string
  linkShareMetadata?: {
    securityUpdateEnabled?: boolean
    securityUpdateEligible?: boolean
  }
  inheritedPermissionsDisabled?: boolean
  contentRestrictions?: { readOnly?: boolean }[]
  downloadRestrictions?: {
    effectiveDownloadRestrictionWithContext?: {
      restrictedForReaders?: boolean
      restrictedForWriters?: boolean
    }
  }
  capabilities?: {
    canDownload?: boolean
    canEdit?: boolean
    canModifyContent?: boolean
  }
}

function requiresResourceKey(file: PublicFile) {
  return (
    Boolean(file.resourceKey) ||
    (file.linkShareMetadata?.securityUpdateEnabled === true &&
      file.linkShareMetadata.securityUpdateEligible !== false)
  )
}

function policyObservation(
  file: PublicFile,
  publicRole: 'reader' | 'writer' | undefined = undefined,
) {
  const restriction =
    file.downloadRestrictions?.effectiveDownloadRestrictionWithContext
  return {
    canDownload: file.capabilities?.canDownload ?? null,
    canEdit: file.capabilities?.canEdit ?? null,
    canModifyContent: file.capabilities?.canModifyContent ?? null,
    securityUpdateEligible:
      file.linkShareMetadata?.securityUpdateEligible ?? null,
    securityUpdateEnabled:
      file.linkShareMetadata?.securityUpdateEnabled ?? null,
    resourceKeyPresent: Boolean(file.resourceKey),
    inheritedPermissionsDisabled: file.inheritedPermissionsDisabled ?? null,
    publicRole: publicRole ?? null,
    contentReadOnly:
      file.contentRestrictions?.some(
        (contentRestriction) => contentRestriction.readOnly === true,
      ) ?? false,
    downloadRestrictedForReaders: restriction?.restrictedForReaders ?? null,
    downloadRestrictedForWriters: restriction?.restrictedForWriters ?? null,
  }
}

function driveHeaders(token: string, resource: Resource) {
  const headers = new Headers({ Authorization: `Bearer ${token}` })
  if (resource.resourceKey)
    headers.set(
      'X-Goog-Drive-Resource-Keys',
      `${resource.fileId}/${resource.resourceKey}`,
    )
  return headers
}

async function checkedFetch(
  url: URL,
  headers: Headers,
  init: RequestInit = {},
) {
  url.searchParams.set('supportsAllDrives', 'true')
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    const stage = url.pathname.endsWith('/permissions')
      ? 'permissions'
      : url.pathname.startsWith('/upload/')
        ? 'publication'
        : 'metadata'
    throw new PublicDriveProviderFailure(stage, response.status)
  }
  return response
}

async function publicPolicy(
  token: string,
  resource: Resource,
  enforceResourceKey = false,
) {
  const headers = driveHeaders(token, resource)
  const metadataUrl = new URL(
    `https://www.googleapis.com/drive/v3/files/${resource.fileId}`,
  )
  metadataUrl.searchParams.set('fields', publicFields)
  let metadataResponse: Response
  try {
    metadataResponse = await checkedFetch(metadataUrl, headers)
  } catch (error) {
    if (error instanceof AccessFailure && error.status === 404)
      throw new PublicAccessLost(404)
    throw error
  }
  const file = (await metadataResponse.json()) as PublicFile
  const deny = (status: number, reason: PolicyDenialReason) => {
    throw new PublicPolicyFailure(status, reason, policyObservation(file))
  }
  if (file.id !== resource.fileId) deny(404, 'resourceMismatch')
  if (file.trashed) deny(404, 'fileTrashed')
  if (!(
    conceptMimeTypes.includes(file.mimeType) ||
    ([
      'application/octet-stream',
      'application/zip',
      'application/x-zip-compressed',
    ].includes(file.mimeType) &&
      typeof file.name === 'string' &&
      /\.concept$/i.test(file.name))
  ))
    deny(404, 'unsupportedPackageType')
  if (enforceResourceKey && requiresResourceKey(file) && !file.resourceKey)
    deny(404, 'resourceKeyRequired')
  if (
    enforceResourceKey &&
    requiresResourceKey(file) &&
    resource.resourceKey !== file.resourceKey
  )
    deny(404, 'resourceKeyMismatch')
  if (file.capabilities?.canDownload !== true)
    deny(403, 'publisherCannotDownload')
  if (file.capabilities?.canEdit !== true) deny(403, 'publisherCannotEdit')
  if (file.capabilities?.canModifyContent !== true)
    deny(403, 'publisherCannotModifyContent')
  // Limited-access ACL entries may describe inherited metadata visibility rather
  // than effective anonymous content access; do not derive a public grant there.
  if (file.inheritedPermissionsDisabled) deny(403, 'limitedAccessUnsupported')
  let publicRole: 'reader' | 'writer' | undefined
  let nextPageToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${resource.fileId}/permissions`,
    )
    url.searchParams.set(
      'fields',
      'nextPageToken,permissions(type,role,view,permissionDetails(inherited))',
    )
    url.searchParams.set('pageSize', '100')
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken)
    const data = (await (await checkedFetch(url, headers)).json()) as {
      nextPageToken?: string
      permissions?: {
        type?: string
        role?: string
        view?: string
        permissionDetails?: { inherited?: boolean }[]
      }[]
    }
    if (!Array.isArray(data.permissions)) throw new AccessFailure(503)
    for (const permission of data.permissions) {
      if (permission.type !== 'anyone' || permission.view) continue
      if (permission.role === 'writer') publicRole = 'writer'
      else if (
        !publicRole &&
        ['reader', 'commenter'].includes(permission.role ?? '')
      )
        publicRole = 'reader'
    }
    nextPageToken = data.nextPageToken
    if (!nextPageToken) break
    if (page === 9) throw new AccessFailure(503)
  }
  if (!publicRole)
    throw new PublicPolicyFailure(
      404,
      'publicPermissionMissing',
      policyObservation(file),
    )
  const restriction =
    file.downloadRestrictions?.effectiveDownloadRestrictionWithContext
  if (
    restriction?.restrictedForWriters ||
    (publicRole === 'reader' && restriction?.restrictedForReaders)
  )
    throw new PublicPolicyFailure(
      403,
      'publicDownloadRestricted',
      policyObservation(file, publicRole),
    )
  return {
    file,
    publicRole,
    readOnly:
      publicRole !== 'writer' ||
      file.contentRestrictions?.some(
        (contentRestriction) => contentRestriction.readOnly,
      ) === true,
  }
}

async function publisherToken(
  bindings: Cloudflare.Env,
  origin: string,
  publisher: Publisher,
) {
  const auth = createAuth(bindings, origin)
  // This trusted server call intentionally has no browser headers: only the stored
  // publisher relation selects which encrypted linked-account credentials to use.
  const tokens = await auth.api.getAccessToken({
    body: { userId: publisher.userId, accountId: publisher.accountId },
  })
  if (!tokens.accessToken) throw new AccessFailure(503)
  return tokens.accessToken
}

export async function registerPublicPublisher(
  request: Request,
  bindings: Cloudflare.Env,
  resource: Resource,
) {
  let stage: RegistrationStage = 'identity'
  try {
    const identity = await getIdentity(request, bindings)
    stage = 'registry_read'
    const consentEpoch = await bindings.DB.prepare(
      'select version from public_drive_publisher_epoch where userId = ?',
    )
      .bind(identity.userId)
      .first<{ version: number }>()
    const version = consentEpoch?.version ?? 0
    stage = 'credentials'
    const tokens = await identity.auth.api.getAccessToken({
      headers: request.headers,
      body: { accountId: identity.internalAccountId },
    })
    if (!tokens.accessToken) throw new AccessFailure(401)
    stage = 'policy'
    const policy = await publicPolicy(tokens.accessToken, resource)
    if (policy.readOnly)
      throw new PublicPolicyFailure(
        403,
        policy.file.contentRestrictions?.some(
          (restriction) => restriction.readOnly,
        )
          ? 'contentReadOnly'
          : 'publicWritePermissionRequired',
        policyObservation(policy.file, policy.publicRole),
      )
    const resourceKey = requiresResourceKey(policy.file)
      ? policy.file.resourceKey
      : null
    if (requiresResourceKey(policy.file) && !resourceKey)
      throw new PublicPolicyFailure(
        403,
        'resourceKeyUnavailable',
        policyObservation(policy.file, policy.publicRole),
      )
    stage = 'registry_write'
    const result = await bindings.DB.prepare(
      'insert into public_drive_publisher (fileId, userId, accountId, resourceKey, updatedAt) select ?, ?, ?, ?, ? where coalesce((select version from public_drive_publisher_epoch where userId = ?), 0) = ? on conflict(fileId) do update set userId=excluded.userId, accountId=excluded.accountId, resourceKey=excluded.resourceKey, updatedAt=excluded.updatedAt',
    )
      .bind(
        resource.fileId,
        identity.userId,
        identity.internalAccountId,
        resourceKey ?? null,
        Date.now(),
        identity.userId,
        version,
      )
      .run()
    if (result.meta.changes === 0) throw new AccessFailure(409)
  } catch (error) {
    const status = error instanceof AccessFailure ? error.status : 503
    const providerStatus =
      error instanceof PublicDriveProviderFailure
        ? error.providerStatus
        : undefined
    const observedStage =
      error instanceof PublicDriveProviderFailure &&
      error.stage !== 'publication'
        ? error.stage
        : stage
    const failure = new PublisherRegistrationFailure(
      observedStage,
      status,
      providerStatus,
      error instanceof PublicPolicyFailure
        ? { reason: error.denialReason, observation: error.observation }
        : undefined,
    )
    if (
      failure.policy &&
      ![
        'publicPermissionMissing',
        'publicWritePermissionRequired',
        'unsupportedPackageType',
      ].includes(failure.policy.reason)
    )
      console.warn(
        JSON.stringify({
          event: 'public_drive_registration_denied',
          stage: failure.stage,
          status,
          policyReason: failure.policy.reason,
          diagnostics: failure.policy.observation,
        }),
      )
    if (![401, 403, 404].includes(status))
      console.warn(
        JSON.stringify({
          event: 'public_drive_registration_failed',
          stage: failure.stage,
          status,
          providerStatus,
        }),
      )
    throw failure
  }
}

async function signingKey(bindings: Cloudflare.Env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(bindings.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

export async function anonymousIdentity(
  request: Request,
  bindings: Cloudflare.Env,
  headers: Headers,
) {
  const cookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
  const key = await signingKey(bindings)
  if (cookie && /^[\w-]{36}\.[a-f0-9]{64}$/.test(cookie)) {
    const [id, signature] = cookie.split('.')
    const bytes = new Uint8Array(
      signature.match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
    )
    if (
      await crypto.subtle.verify(
        'HMAC',
        key,
        bytes,
        new TextEncoder().encode(id),
      )
    )
      return `anonymous:${id}`
  }
  const id = crypto.randomUUID()
  const signature = hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id)),
  )
  headers.append(
    'Set-Cookie',
    `${cookieName}=${id}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
  )
  return `anonymous:${id}`
}

export async function authorizePublic(
  request: Request,
  bindings: Cloudflare.Env,
  resource: Resource,
) {
  const startedAt = Date.now()
  const publisherQuery =
    'select p.fileId, p.userId, p.accountId, p.resourceKey, p.updatedAt, coalesce(e.version, 0) as consentVersion from public_drive_publisher p left join public_drive_publisher_epoch e on e.userId = p.userId where p.fileId = ?'
  const observed = await bindings.DB.prepare(publisherQuery)
    .bind(resource.fileId)
    .first<Publisher>()
  const publisher = observed ? { ...observed } : null
  if (!publisher) throw new AccessFailure(404)
  const token = await publisherToken(
    bindings,
    new URL(request.url).origin,
    publisher,
  )
  let policy: Awaited<ReturnType<typeof publicPolicy>>
  try {
    policy = await publicPolicy(token, resource, true)
  } catch (error) {
    if (
      error instanceof PublicAccessLost ||
      (error instanceof PublicPolicyFailure &&
        !['resourceKeyRequired', 'resourceKeyMismatch'].includes(
          error.denialReason,
        ))
    )
      await bindings.REALTIME_ROOMS.getByName(
        `google-drive:${resource.fileId}`,
      ).invalidateAnonymousGrants()
    throw error
  }
  if (policy.readOnly)
    await bindings.REALTIME_ROOMS.getByName(
      `google-drive:${resource.fileId}`,
    ).invalidateAnonymousGrants(true)
  else
    await bindings.REALTIME_ROOMS.getByName(
      `google-drive:${resource.fileId}`,
    ).observePublicWritable()
  const current = await bindings.DB.prepare(publisherQuery)
    .bind(resource.fileId)
    .first<Publisher>()
  if (
    !current ||
    current.userId !== publisher.userId ||
    current.accountId !== publisher.accountId ||
    current.resourceKey !== publisher.resourceKey ||
    current.consentVersion !== publisher.consentVersion
  )
    throw new AccessFailure(404)
  if (startedAt + grantLifetimeMs <= Date.now()) throw new AccessFailure(503)
  return { token, policy, expiresAt: startedAt + grantLifetimeMs }
}

export async function publicRealtimeGrant(
  request: Request,
  bindings: Cloudflare.Env,
  resource: Resource,
  id: string,
  accountId = id,
): Promise<RealtimeGrant> {
  if (
    !(await bindings.REALTIME_ROOMS.getByName(
      `google-drive:${resource.fileId}`,
    ).permitPublicHttp(id, false))
  )
    throw new AccessFailure(429)
  const publicEpoch = await bindings.REALTIME_ROOMS.getByName(
    `google-drive:${resource.fileId}`,
  ).getPublicEpoch()
  const access = await authorizePublic(request, bindings, resource)
  return {
    userId: id,
    accountId,
    readOnly: access.policy.readOnly,
    expiresAt: access.expiresAt,
    publicAccess: true,
    publicEpoch,
  }
}

function boundedStream(
  stream: ReadableStream<Uint8Array>,
  maximum = packageLimits.packageBytes,
) {
  let bytes = 0
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > maximum) throw new AccessFailure(413)
        controller.enqueue(chunk)
      },
    }),
  )
}

async function multipartStream(
  request: Request,
  filename: string,
  boundary: string,
) {
  if (!request.body) throw new AccessFailure(400)
  const length = request.headers.get('Content-Length')
  if (
    length &&
    (!/^\d+$/.test(length) || Number(length) > packageLimits.packageBytes)
  )
    throw new AccessFailure(413)
  const encoder = new TextEncoder()
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ title: filename, mimeType: conceptMimeType })}\r\n--${boundary}\r\nContent-Type: ${conceptMimeType}\r\n\r\n`,
  )
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`)
  const reader = boundedStream(request.body).getReader()
  let began = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!began) {
        began = true
        controller.enqueue(prefix)
        return
      }
      try {
        const next = await reader.read()
        if (next.done) {
          controller.enqueue(suffix)
          controller.close()
          reader.releaseLock()
        } else controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
        await reader.cancel(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export async function handlePublicDrive(
  request: Request,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  })
  let resource: Resource | undefined
  try {
    const operation = url.pathname.slice('/api/public-drive/'.length)
    if (!['register', 'disconnect', 'metadata', 'content'].includes(operation))
      throw new AccessFailure(404)
    if (
      request.method !==
      (['register', 'disconnect'].includes(operation)
        ? 'POST'
        : operation === 'content' && request.method === 'PUT'
          ? 'PUT'
          : 'GET')
    )
      throw new AccessFailure(405)
    const origin = request.headers.get('Origin')
    if (
      (request.method !== 'GET' && origin !== url.origin) ||
      (origin && origin !== url.origin) ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site'
    )
      throw new AccessFailure(403)
    if (operation === 'disconnect') {
      const session = await createAuth(bindings, url.origin).api.getSession({
        headers: request.headers,
      })
      if (!session) throw new AccessFailure(401)
      const rows = await bindings.DB.prepare(
        'select fileId from public_drive_publisher where userId = ?',
      )
        .bind(session.user.id)
        .all<{ fileId: string }>()
      await bindings.DB.batch([
        bindings.DB.prepare(
          'insert into public_drive_publisher_epoch (userId, version) values (?, 1) on conflict(userId) do update set version=version+1',
        ).bind(session.user.id),
        bindings.DB.prepare(
          'delete from public_drive_publisher where userId = ?',
        ).bind(session.user.id),
      ])
      for (const row of rows.results)
        await bindings.REALTIME_ROOMS.getByName(
          `google-drive:${row.fileId}`,
        ).invalidateAnonymousGrants()
      return Response.json({ disconnected: true }, { headers })
    }
    resource = parseResource(url)
    if (operation === 'register') {
      await registerPublicPublisher(request, bindings, resource)
      return Response.json({ registered: true }, { headers })
    }
    const visitor = await anonymousIdentity(request, bindings, headers)
    if (
      !(await bindings.REALTIME_ROOMS.getByName(
        `google-drive:${resource.fileId}`,
      ).permitPublicHttp(visitor, request.method === 'PUT'))
    )
      throw new AccessFailure(429)
    let access = await authorizePublic(request, bindings, resource)
    let response: Response
    const googleHeaders = driveHeaders(access.token, resource)
    if (request.method === 'PUT') {
      if (access.policy.readOnly) throw new AccessFailure(403)
      const etag = request.headers.get('If-Match')
      if (
        !etag ||
        etag === '*' ||
        etag.length > 1024 ||
        !/^"[^"\r\n]+"$/.test(etag)
      )
        throw new AccessFailure(428)
      const filename = url.searchParams.get('filename') ?? ''
      if (
        !filename ||
        filename.length > packageLimits.nameCharacters ||
        /[\r\n\0]/.test(filename)
      )
        throw new AccessFailure(400)
      const boundary = `concept_${crypto.randomUUID()}`
      const body = await multipartStream(request, filename, boundary)
      // Recheck public policy at the publication boundary; the publisher's own
      // OAuth write capability must never stand in for the public Drive grant.
      access = await authorizePublic(request, bindings, resource)
      if (access.policy.readOnly) throw new AccessFailure(403)
      googleHeaders.set('Authorization', `Bearer ${access.token}`)
      googleHeaders.set('If-Match', etag)
      googleHeaders.set(
        'Content-Type',
        `multipart/related; boundary=${boundary}`,
      )
      const target = new URL(
        `https://www.googleapis.com/upload/drive/v2/files/${resource.fileId}`,
      )
      target.searchParams.set('uploadType', 'multipart')
      target.searchParams.set('fields', v2Fields)
      response = await checkedFetch(target, googleHeaders, {
        method: 'PUT',
        body,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
      })
    } else if (operation === 'metadata') {
      const target = new URL(
        `https://www.googleapis.com/drive/v2/files/${resource.fileId}`,
      )
      target.searchParams.set('fields', v2Fields)
      response = await checkedFetch(target, googleHeaders)
    } else {
      const target = new URL(
        `https://www.googleapis.com/drive/v3/files/${resource.fileId}`,
      )
      target.searchParams.set('alt', 'media')
      response = await checkedFetch(target, googleHeaders)
    }
    if (operation === 'metadata' || request.method === 'PUT') {
      const metadata = (await response.json()) as Record<string, unknown>
      metadata.capabilities = {
        canDownload: true,
        canEdit: !access.policy.readOnly,
        canModifyContent: !access.policy.readOnly,
        canCopy: true,
        canComment: false,
      }
      return Response.json(metadata, { headers })
    }
    headers.set('Content-Type', conceptMimeType)
    const size = response.headers.get('Content-Length')
    if (size && Number(size) > packageLimits.packageBytes) {
      await response.body?.cancel()
      throw new AccessFailure(413)
    }
    return new Response(response.body ? boundedStream(response.body) : null, {
      headers,
    })
  } catch (error) {
    const status = error instanceof AccessFailure ? error.status : 503
    return Response.json(
      {
        error: {
          message:
            error instanceof PublisherRegistrationFailure
              ? 'Anonymous sharing could not be enabled.'
              : 'Public Google Drive access could not be verified.',
          ...(error instanceof PublisherRegistrationFailure
            ? {
                code: error.code,
                stage: error.stage,
                providerStatus: error.providerStatus,
                policyReason: error.policy?.reason,
                diagnostics: error.policy?.observation,
              }
            : {}),
          errors: [
            {
              reason:
                error instanceof PublisherRegistrationFailure
                  ? error.code
                  : status === 403 || status === 404
                    ? 'publicAccessLost'
                    : 'publicAccessUnavailable',
            },
          ],
        },
      },
      { status, headers },
    )
  }
}
