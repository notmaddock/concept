import {
  forwardCookies,
  resolveGoogleDriveAccount,
} from '../drive/drive-token.server'
import { realtimePolicy } from './policy'
import { signRealtimeTicket } from './ticket'
import { fetchDriveCapabilities } from './drive.server'
import type { DocumentCapabilities } from './capabilities'

export interface RealtimeTicketRequest {
  storage: string
  fileId: string
}

export interface IssueRealtimeTicketDeps {
  userId: string
  accessToken: string
  secret: string
  now?: number
  enabled?: boolean
  fetchCapabilities?: (
    fileId: string,
    accessToken: string,
  ) => Promise<DocumentCapabilities | undefined>
}

/**
 * Dependency-injected core of the ticket endpoint: validates the handle,
 * checks Drive capabilities with the user's own token, and signs a
 * short-lived ticket bound to (userId, fileId, capabilities).
 */
export async function issueRealtimeTicket(
  input: RealtimeTicketRequest,
  deps: IssueRealtimeTicketDeps,
): Promise<{ status: number; body: object }> {
  if (deps.enabled === false)
    return {
      status: 403,
      body: { error: 'Realtime collaboration is disabled.' },
    }
  const keys = Object.keys(input).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'fileId' ||
    keys[1] !== 'storage' ||
    input.storage !== 'google-drive' ||
    typeof input.fileId !== 'string' ||
    input.fileId.length === 0
  )
    return { status: 400, body: { error: 'Invalid request.' } }
  const fetchCapabilities = deps.fetchCapabilities ?? fetchDriveCapabilities
  const capabilities = await fetchCapabilities(input.fileId, deps.accessToken)
  if (!capabilities || !capabilities.view)
    return { status: 403, body: { error: 'No access to this document.' } }
  const now = deps.now ?? Date.now()
  const expiresAt = now + realtimePolicy.ticketTtlMs
  const ticket = await signRealtimeTicket(
    {
      jti: crypto.randomUUID(),
      userId: deps.userId,
      fileId: input.fileId,
      capabilities,
      exp: expiresAt,
    },
    deps.secret,
  )
  return { status: 200, body: { ticket, expiresAt, capabilities } }
}

/**
 * POST /api/realtime/ticket. Thin adapter over `issueRealtimeTicket`:
 * verifies the better-auth session, loads the user's Google Drive token, and
 * checks the Origin like `/api/drive/token` does.
 */
export async function handleRealtimeTicket(
  request: Request,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '')
  const responseHeaders = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
  })
  const json = (value: object, status = 200) =>
    Response.json(value, { status, headers: responseHeaders })
  if (pathname !== '/api/realtime/ticket')
    return json({ error: 'Not found.' }, 404)
  if (request.method !== 'POST') {
    responseHeaders.set('Allow', 'POST')
    return json({ error: 'Method not allowed.' }, 405)
  }
  if (request.headers.get('Origin') !== url.origin)
    return json({ error: 'Invalid request origin.' }, 403)
  if (bindings.REALTIME_ENABLED === 'false')
    return json({ error: 'Realtime collaboration is disabled.' }, 403)
  let input: RealtimeTicketRequest
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Invalid request.' }, 400)
    input = body as RealtimeTicketRequest
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  try {
    const { auth, session, account } = await resolveGoogleDriveAccount(
      request,
      bindings,
      url.origin,
      responseHeaders,
    )
    if (!session) return json({ error: 'Sign in required.' }, 401)
    if (!account) return json({ error: 'Reconnect Google Drive.' }, 401)
    const tokens = await auth.api.getAccessToken({
      headers: request.headers,
      body: { accountId: account.id },
      returnHeaders: true,
    })
    forwardCookies(tokens.headers, responseHeaders)
    const { accessToken } = tokens.response
    if (!accessToken) return json({ error: 'Reconnect Google Drive.' }, 401)
    const result = await issueRealtimeTicket(input, {
      userId: session.user.id,
      accessToken,
      secret: bindings.BETTER_AUTH_SECRET,
    })
    return json(result.body, result.status)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'headers' in error &&
      error.headers instanceof Headers
    )
      forwardCookies(error.headers, responseHeaders)
    console.error('Realtime ticket request failed', error)
    return json(
      { error: 'Realtime collaboration is temporarily unavailable.' },
      500,
    )
  }
}
