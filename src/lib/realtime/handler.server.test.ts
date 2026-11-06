import { beforeEach, expect, it, vi } from 'vitest'
import { handleRealtime } from './handler.server'
import { AccessFailure } from './access.server'
import type * as AccessModule from './access.server'

const mocks = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  checkDriveAccess: vi.fn(),
  anonymousIdentity: vi.fn(),
  publicRealtimeGrant: vi.fn(),
  registerPublicPublisher: vi.fn(),
}))
vi.mock('./access.server', async (original) => ({
  ...(await original<typeof AccessModule>()),
  getIdentity: mocks.getIdentity,
  checkDriveAccess: mocks.checkDriveAccess,
}))
vi.mock('#/lib/documents/drive/public.server', () => ({
  anonymousIdentity: mocks.anonymousIdentity,
  publicRealtimeGrant: mocks.publicRealtimeGrant,
  registerPublicPublisher: mocks.registerPublicPublisher,
}))
const room = {
  beginAuthorization: vi.fn(),
  finishAuthorization: vi.fn(),
  renewGrant: vi.fn(),
  fetch: vi.fn(),
}
const bindings = Object.assign({} as Cloudflare.Env, {
  REALTIME_ROOMS: { getByName: () => room },
})
const origin = 'https://concept.example'
const grant = {
  userId: 'session-user',
  accountId: 'session-account',
  readOnly: false,
  expiresAt: Date.now() + 60_000,
}
function request(query = '') {
  return new Request(`${origin}/api/realtime/access?fileId=file${query}`, {
    method: 'POST',
    headers: { Origin: origin },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getIdentity.mockResolvedValue({
    userId: 'session-user',
    accountId: 'session-account',
  })
  mocks.checkDriveAccess.mockResolvedValue(grant)
  mocks.registerPublicPublisher.mockResolvedValue(undefined)
  mocks.anonymousIdentity.mockResolvedValue('anonymous:visitor')
  room.beginAuthorization.mockResolvedValue(1)
  room.finishAuthorization.mockResolvedValue(true)
  room.renewGrant.mockResolvedValue(true)
})

it('keeps existing grants untouched after transient provider failures', async () => {
  mocks.checkDriveAccess.mockRejectedValue(new AccessFailure(503))
  const response = await handleRealtime(
    request('&connectionId=current'),
    bindings,
  )
  expect(response.status).toBe(503)
  expect(room.finishAuthorization).not.toHaveBeenCalled()
  expect(room.renewGrant).not.toHaveBeenCalled()
})

it('renews only the session-owned connection after fresh Drive authorization', async () => {
  const response = await handleRealtime(
    request('&connectionId=current'),
    bindings,
  )
  expect(response.status).toBe(200)
  expect(room.finishAuthorization).toHaveBeenCalledWith(
    'session-user',
    1,
    grant,
  )
  expect(room.renewGrant).toHaveBeenCalledWith(
    'session-user',
    'current',
    1,
    grant,
  )
  room.renewGrant.mockResolvedValue(false)
  expect(
    (await handleRealtime(request('&connectionId=guessed'), bindings)).status,
  ).toBe(409)
  expect(room.finishAuthorization).not.toHaveBeenCalledWith(
    'session-user',
    1,
    null,
  )
})

it('revokes confirmed loss while refusing to resurrect stale authorization results', async () => {
  mocks.checkDriveAccess.mockRejectedValue(new AccessFailure(403))
  expect((await handleRealtime(request(), bindings)).status).toBe(403)
  expect(room.finishAuthorization).toHaveBeenCalledWith('session-user', 1, null)
  vi.clearAllMocks()
  mocks.checkDriveAccess.mockResolvedValue(grant)
  room.beginAuthorization.mockResolvedValue(1)
  room.finishAuthorization.mockResolvedValue(false)
  expect((await handleRealtime(request(), bindings)).status).toBe(409)
  expect(room.finishAuthorization).toHaveBeenCalledTimes(1)
})

it('admits unsigned visitors only through verified public access', async () => {
  mocks.getIdentity.mockRejectedValue(new AccessFailure(401))
  const publicGrant = {
    userId: 'anonymous:visitor',
    accountId: 'anonymous:visitor',
    readOnly: false,
    publicAccess: true,
    expiresAt: Date.now() + 60_000,
  }
  mocks.publicRealtimeGrant.mockResolvedValue(publicGrant)
  expect((await handleRealtime(request(), bindings)).status).toBe(200)
  expect(mocks.checkDriveAccess).not.toHaveBeenCalled()
  expect(room.finishAuthorization).toHaveBeenCalledWith(
    'anonymous:visitor',
    1,
    publicGrant,
  )
  mocks.publicRealtimeGrant.mockRejectedValue(new AccessFailure(404))
  expect((await handleRealtime(request(), bindings)).status).toBe(404)
})

it('denies cross-origin admission before any session, provider or room activity', async () => {
  const foreign = new Request(`${origin}/api/realtime/access?fileId=file`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  })
  expect((await handleRealtime(foreign, bindings)).status).toBe(403)
  expect(mocks.getIdentity).not.toHaveBeenCalled()
  expect(room.beginAuthorization).not.toHaveBeenCalled()
})
