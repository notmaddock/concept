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
  const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie' }
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
    const identity = await getIdentity(request, bindings)
    userId = identity.userId
    room = bindings.REALTIME_ROOMS.getByName(`google-drive:${resource.fileId}`)
    epoch = await room.beginAuthorization(userId)
    const grant = await checkDriveAccess(request, identity, resource)
    if (!(await room.finishAuthorization(userId, epoch, grant)))
      throw new AccessFailure(409)
    if (url.pathname.endsWith('/access'))
      return Response.json(
        {
          readOnly: grant.readOnly,
          expiresAt: grant.expiresAt,
          accountId: grant.accountId,
        },
        { headers },
      )
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      throw new AccessFailure(426)
    return await room.join(grant, epoch)
  } catch (error) {
    if (room && userId && epoch !== undefined)
      await room.finishAuthorization(userId, epoch, null)
    const status = error instanceof AccessFailure ? error.status : 503
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
