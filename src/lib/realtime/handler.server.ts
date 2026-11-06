import {
  anonymousIdentity,
  publicRealtimeGrant,
} from '#/lib/documents/drive/public.server'
import {
  AccessFailure,
  checkDriveAccess,
  getIdentity,
  parseResource,
} from './access.server'

export async function handleRealtime(
  request: Request,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Cookie' })
  let room:
    ReturnType<Cloudflare.Env['REALTIME_ROOMS']['getByName']> | undefined
  let userId: string | undefined
  let epoch: number | undefined
  try {
    if (
      !['/api/realtime/access', '/api/realtime/socket'].includes(url.pathname)
    )
      return new Response(null, { status: 404, headers })
    if (request.method !== (url.pathname.endsWith('/access') ? 'POST' : 'GET'))
      return new Response(null, { status: 405, headers })
    if (request.headers.get('Origin') !== url.origin)
      throw new AccessFailure(403)
    const resource = parseResource(url)
    let identity: Awaited<ReturnType<typeof getIdentity>> | undefined
    try {
      identity = await getIdentity(request, bindings)
    } catch (error) {
      if (!(error instanceof AccessFailure && error.status === 401)) throw error
    }
    userId =
      identity?.userId ?? (await anonymousIdentity(request, bindings, headers))
    room = bindings.REALTIME_ROOMS.getByName(`google-drive:${resource.fileId}`)
    epoch = await room.beginAuthorization(userId)
    let grant
    if (identity) {
      try {
        grant = await checkDriveAccess(request, identity, resource)
      } catch (error) {
        if (!(
          error instanceof AccessFailure && [401, 404].includes(error.status)
        ))
          throw error
      }
    }
    grant ??= await publicRealtimeGrant(
      request,
      bindings,
      resource,
      userId,
      identity?.accountId,
    )
    if (!(await room.finishAuthorization(userId, epoch, grant)))
      throw new AccessFailure(409)
    if (url.pathname.endsWith('/access')) {
      const connectionId = url.searchParams.get('connectionId')
      if (
        connectionId &&
        (connectionId.length > 128 ||
          !(await room.renewGrant(userId, connectionId, epoch, grant)))
      )
        throw new AccessFailure(409)
      return Response.json(
        {
          readOnly: grant.readOnly,
          expiresAt: grant.expiresAt,
          accountId: grant.accountId,
        },
        { headers },
      )
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      throw new AccessFailure(426)
    // WebSocket responses cross fetch bindings, but are not RPC-serializable.
    const upgrade = await room.fetch(
      new Request('https://room.internal/', {
        headers: {
          Upgrade: 'websocket',
          'X-Concept-Grant': JSON.stringify(grant),
          'X-Concept-Epoch': String(epoch),
        },
      }),
    )
    const forwarded = new Response(upgrade.body, upgrade)
    for (const cookie of headers.getSetCookie())
      forwarded.headers.append('Set-Cookie', cookie)
    return forwarded
  } catch (error) {
    const status = error instanceof AccessFailure ? error.status : 503
    if (
      room &&
      userId &&
      epoch !== undefined &&
      [401, 403, 404].includes(status)
    )
      await room.finishAuthorization(userId, epoch, null)
    return Response.json(
      {
        error:
          status === 404 || status === 403
            ? 'Document unavailable.'
            : 'Document access could not be verified.',
      },
      { status, headers },
    )
  }
}
