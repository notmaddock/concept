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
  'id,mimeType,trashed,resourceKey,linkShareMetadata(securityUpdateEnabled),inheritedPermissionsDisabled,contentRestrictions(readOnly),downloadRestrictions(effectiveDownloadRestrictionWithContext(restrictedForReaders,restrictedForWriters)),capabilities(canDownload,canEdit,canModifyContent)'
const cookieName = 'concept-anonymous'

class PublicAccessLost extends AccessFailure {}

type Resource = { fileId: string; resourceKey?: string }
type Publisher = {
  fileId: string
  userId: string
  accountId: string
  resourceKey: string | null
}
type PublicFile = {
  id: string
  mimeType: string
  trashed?: boolean
  resourceKey?: string
  linkShareMetadata?: { securityUpdateEnabled?: boolean }
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
    throw new AccessFailure(
      [404, 412, 413].includes(response.status) ? response.status : 503,
    )
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
  if (
    file.id !== resource.fileId ||
    file.trashed ||
    !conceptMimeTypes.includes(file.mimeType)
  )
    throw new PublicAccessLost(404)
  if (
    enforceResourceKey &&
    file.linkShareMetadata?.securityUpdateEnabled &&
    (!file.resourceKey || resource.resourceKey !== file.resourceKey)
  )
    throw new AccessFailure(404)
  if (
    file.capabilities?.canDownload !== true ||
    file.capabilities.canEdit !== true ||
    file.capabilities.canModifyContent !== true
  )
    throw new PublicAccessLost(403)
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
      if (
        file.inheritedPermissionsDisabled &&
        permission.permissionDetails?.some((detail) => detail.inherited)
      )
        continue
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
  if (!publicRole) throw new PublicAccessLost(404)
  const restriction =
    file.downloadRestrictions?.effectiveDownloadRestrictionWithContext
  if (
    restriction?.restrictedForWriters ||
    (publicRole === 'reader' && restriction?.restrictedForReaders)
  )
    throw new PublicAccessLost(403)
  return {
    file,
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
  const identity = await getIdentity(request, bindings)
  const consentEpoch = await bindings.DB.prepare(
    'select version from public_drive_publisher_epoch where userId = ?',
  )
    .bind(identity.userId)
    .first<{ version: number }>()
  const version = consentEpoch?.version ?? 0
  const tokens = await identity.auth.api.getAccessToken({
    headers: request.headers,
    body: { accountId: identity.internalAccountId },
  })
  if (!tokens.accessToken) throw new AccessFailure(401)
  const policy = await publicPolicy(tokens.accessToken, resource)
  if (policy.readOnly) throw new AccessFailure(403)
  const resourceKey = policy.file.linkShareMetadata?.securityUpdateEnabled
    ? (policy.file.resourceKey ?? resource.resourceKey)
    : null
  if (policy.file.linkShareMetadata?.securityUpdateEnabled && !resourceKey)
    throw new AccessFailure(403)
  await bindings.DB.prepare(
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
  const publisher = await bindings.DB.prepare(
    'select fileId, userId, accountId, resourceKey from public_drive_publisher where fileId = ?',
  )
    .bind(resource.fileId)
    .first<Publisher>()
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
    if (error instanceof PublicAccessLost)
      await bindings.REALTIME_ROOMS.getByName(
        `google-drive:${resource.fileId}`,
      ).invalidateAnonymousGrants()
    throw error
  }
  if (policy.readOnly)
    await bindings.REALTIME_ROOMS.getByName(
      `google-drive:${resource.fileId}`,
    ).invalidateAnonymousGrants(true)
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
  const access = await authorizePublic(request, bindings, resource)
  return {
    userId: id,
    accountId,
    readOnly: access.policy.readOnly,
    expiresAt: access.expiresAt,
    publicAccess: true,
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
          message: 'Public Google Drive access could not be verified.',
          errors: [
            {
              reason:
                status === 403 || status === 404
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
