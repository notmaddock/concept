import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkDriveAccess, getIdentity, parseResource } from './access.server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUserAccounts: vi.fn(),
  getAccessToken: vi.fn(),
}))
vi.mock('#/lib/auth.server', () => ({ createAuth: () => ({ api: mocks }) }))
const request = new Request('https://concept.example/api/realtime/access', {
  method: 'POST',
})
const resource = { fileId: 'shared-file', resourceKey: 'link-key' }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  mocks.getSession.mockResolvedValue({ user: { id: 'app-user' } })
  mocks.listUserAccounts.mockResolvedValue([
    {
      providerId: 'google',
      id: 'internal-account',
      accountId: 'google-account',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    },
  ])
  mocks.getAccessToken.mockResolvedValue({ accessToken: 'private-token' })
})
afterEach(() => vi.unstubAllGlobals())

it('uses the session-selected linked account, effective capabilities and resource key', async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      id: resource.fileId,
      capabilities: {
        canDownload: true,
        canEdit: true,
        canModifyContent: true,
      },
    }),
  )
  const identity = await getIdentity(request, {} as Cloudflare.Env)
  const grant = await checkDriveAccess(request, identity, resource)
  expect(grant).toMatchObject({
    userId: 'app-user',
    accountId: 'google-account',
    readOnly: false,
  })
  expect(mocks.getAccessToken).toHaveBeenCalledWith({
    headers: request.headers,
    body: { accountId: 'internal-account' },
  })
  const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers)
  expect(headers.get('X-Goog-Drive-Resource-Keys')).toBe('shared-file/link-key')
  expect(JSON.stringify(grant)).not.toContain('private-token')
})

it('never upgrades ambiguous capabilities and denies prohibited downloads', async () => {
  const identity = await getIdentity(request, {} as Cloudflare.Env)
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      id: resource.fileId,
      capabilities: { canDownload: true, canEdit: true },
    }),
  )
  expect((await checkDriveAccess(request, identity, resource)).readOnly).toBe(
    true,
  )
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      id: resource.fileId,
      capabilities: {
        canDownload: false,
        canEdit: true,
        canModifyContent: true,
      },
    }),
  )
  await expect(
    checkDriveAccess(request, identity, resource),
  ).rejects.toMatchObject({ status: 403 })
})

it('does not classify quota failures as confirmed permission loss', async () => {
  const identity = await getIdentity(request, {} as Cloudflare.Env)
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }))
  await expect(
    checkDriveAccess(request, identity, resource),
  ).rejects.toMatchObject({ status: 503 })
})

it('requires an authenticated linked account and validates resource identifiers', async () => {
  mocks.getSession.mockResolvedValue(null)
  await expect(
    getIdentity(request, {} as Cloudflare.Env),
  ).rejects.toMatchObject({ status: 401 })
  expect(() =>
    parseResource(new URL('https://concept.example/?fileId=bad/file')),
  ).toThrow()
})
