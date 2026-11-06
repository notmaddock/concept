import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  authorizePublic,
  handlePublicDrive,
  publicRealtimeGrant,
} from './public.server'
import { packageLimits } from '../limits'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUserAccounts: vi.fn(),
  getAccessToken: vi.fn(),
}))
vi.mock('#/lib/auth.server', () => ({ createAuth: () => ({ api: auth }) }))
const origin = 'https://concept.example'
const publisher = {
  fileId: 'file',
  userId: 'stored-publisher',
  accountId: 'stored-account-row',
  resourceKey: null as string | null,
}
const execute = vi.fn()
const first = vi.fn()
const all = vi.fn()
const invalidateAnonymousGrants = vi.fn()
const permitPublicHttp = vi.fn()
const getPublicEpoch = vi.fn()
const observePublicWritable = vi.fn()
const bind = vi.fn()
const bindings = Object.assign({} as Cloudflare.Env, {
  BETTER_AUTH_SECRET: 'private-signing-key',
  DB: {
    prepare: vi.fn(() => ({ bind })),
    batch: vi.fn(async () => {
      await execute()
    }),
  },
  REALTIME_ROOMS: {
    getByName: () => ({
      invalidateAnonymousGrants,
      permitPublicHttp,
      getPublicEpoch,
      observePublicWritable,
    }),
  },
})
let publicRole: string | undefined
let downloadRestricted = false
let inheritedPermissionsDisabled = false
let currentResourceKey: string | undefined
let uploaded: string | undefined
const oldPackageLimit = packageLimits.packageBytes

function request(path = 'metadata', init: RequestInit = {}, query = '') {
  return new Request(`${origin}/api/public-drive/${path}?fileId=file${query}`, {
    ...init,
    headers: { Origin: origin, ...init.headers },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  execute.mockResolvedValue({ success: true, meta: { changes: 1 } })
  publicRole = 'writer'
  currentResourceKey = undefined
  downloadRestricted = false
  inheritedPermissionsDisabled = false
  uploaded = undefined
  publisher.resourceKey = null
  first.mockResolvedValue(publisher)
  bind.mockReturnValue({ first, run: execute, all })
  all.mockResolvedValue({ results: [{ fileId: 'file' }] })
  permitPublicHttp.mockResolvedValue(true)
  getPublicEpoch.mockResolvedValue(0)
  auth.getSession.mockResolvedValue({ user: { id: 'signed-user' } })
  auth.listUserAccounts.mockResolvedValue([
    {
      providerId: 'google',
      id: 'signed-account-row',
      accountId: 'google-id',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    },
  ])
  auth.getAccessToken.mockResolvedValue({
    accessToken: 'private-publisher-token',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/permissions'))
        return Response.json({
          permissions: publicRole
            ? [{ type: 'anyone', role: publicRole }]
            : [{ type: 'user', role: 'owner' }],
        })
      if (url.pathname.startsWith('/upload/')) {
        uploaded = await new Response(init?.body).text()
        return Response.json({
          id: 'file',
          title: 'example.concept',
          mimeType: 'application/vnd.concept+zip',
          etag: '"new"',
        })
      }
      if (url.pathname.includes('/v2/'))
        return Response.json({
          id: 'file',
          title: 'example.concept',
          mimeType: 'application/vnd.concept+zip',
          etag: '"old"',
          capabilities: { canEdit: true },
        })
      if (url.searchParams.get('alt') === 'media')
        return new Response('PK package bytes')
      return Response.json({
        id: 'file',
        mimeType: 'application/vnd.concept+zip',
        resourceKey: currentResourceKey,
        inheritedPermissionsDisabled,
        linkShareMetadata: {
          securityUpdateEnabled: Boolean(currentResourceKey),
        },
        capabilities: {
          canDownload: true,
          canEdit: true,
          canModifyContent: true,
        },
        downloadRestrictions: {
          effectiveDownloadRestrictionWithContext: {
            restrictedForWriters: downloadRestricted,
          },
        },
      })
    }),
  )
})
afterEach(() => {
  packageLimits.packageBytes = oldPackageLimit
  vi.unstubAllGlobals()
})

it('uses only registered publisher credentials and never returns them to visitors', async () => {
  const response = await handlePublicDrive(request(), bindings)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    etag: '"old"',
    capabilities: { canEdit: true, canDownload: true },
  })
  expect(auth.getAccessToken).toHaveBeenCalledWith({
    body: { userId: 'stored-publisher', accountId: 'stored-account-row' },
  })
  expect(auth.getSession).not.toHaveBeenCalled()
  expect(response.headers.get('Set-Cookie')).toContain(
    'HttpOnly; Secure; SameSite=Lax',
  )
  expect(response.headers.get('Set-Cookie')).not.toContain(
    'private-publisher-token',
  )
})

it('requires current public permission and download policy despite publisher write access', async () => {
  publicRole = undefined
  expect((await handlePublicDrive(request(), bindings)).status).toBe(404)
  expect(invalidateAnonymousGrants).toHaveBeenCalled()
  publicRole = 'writer'
  downloadRestricted = true
  expect((await handlePublicDrive(request(), bindings)).status).toBe(403)
})

it('checks current resource keys without allowing guesses to disconnect collaborators', async () => {
  publisher.resourceKey = 'old-link-key'
  currentResourceKey = 'rotated-key'
  const wrong = await handlePublicDrive(request(), bindings)
  expect(wrong.status).toBe(404)
  expect(invalidateAnonymousGrants).not.toHaveBeenCalled()
  const valid = await handlePublicDrive(
    request('metadata', {}, '&resourceKey=rotated-key'),
    bindings,
  )
  expect(valid.status).toBe(200)
  first.mockResolvedValue(null)
  auth.getAccessToken.mockClear()
  await expect(
    authorizePublic(request(), bindings, { fileId: 'file' }),
  ).rejects.toMatchObject({ status: 404 })
  expect(auth.getAccessToken).not.toHaveBeenCalled()
})

it('keeps viewers read-only when their delegated publisher remains an editor', async () => {
  publicRole = 'reader'
  const response = await handlePublicDrive(request(), bindings)
  expect(await response.json()).toMatchObject({
    capabilities: {
      canEdit: false,
      canModifyContent: false,
      canDownload: true,
    },
  })
  const save = await handlePublicDrive(
    request(
      'content',
      { method: 'PUT', body: 'PK data', headers: { 'If-Match': '"old"' } },
      '&filename=example.concept',
    ),
    bindings,
  )
  expect(save.status).toBe(403)
  expect(uploaded).toBeUndefined()
})

it('conditionally publishes bounded media with safe server-built metadata', async () => {
  const response = await handlePublicDrive(
    request(
      'content',
      {
        method: 'PUT',
        body: 'PK complete package',
        headers: { 'If-Match': '"old"' },
      },
      '&filename=example.concept',
    ),
    bindings,
  )
  expect(response.status).toBe(200)
  expect(uploaded).toContain('PK complete package')
  expect(uploaded).toContain('"title":"example.concept"')
  expect(uploaded).not.toContain('private-publisher-token')
  const uploadCall = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).includes('/upload/'))!
  expect(new Headers(uploadCall[1]?.headers).get('If-Match')).toBe('"old"')
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('/permissions')),
  ).toHaveLength(2)
})

it('rejects missing validators, cross-origin writes and oversized streamed bodies', async () => {
  expect(
    (
      await handlePublicDrive(
        request(
          'content',
          { method: 'PUT', body: 'PK data' },
          '&filename=example.concept',
        ),
        bindings,
      )
    ).status,
  ).toBe(428)
  expect(
    (
      await handlePublicDrive(
        request('content', {
          method: 'PUT',
          body: 'PK data',
          headers: { Origin: 'https://attacker.example' },
        }),
        bindings,
      )
    ).status,
  ).toBe(403)
  packageLimits.packageBytes = 3
  expect(
    (
      await handlePublicDrive(
        request(
          'content',
          {
            method: 'PUT',
            body: 'PK too large',
            headers: { 'If-Match': '"old"' },
          },
          '&filename=example.concept',
        ),
        bindings,
      )
    ).status,
  ).toBe(413)
})

it('registers only the requesting signed-in account after a fresh public writer check', async () => {
  const response = await handlePublicDrive(
    request('register', { method: 'POST' }),
    bindings,
  )
  expect(response.status).toBe(200)
  expect(bind).toHaveBeenCalledWith(
    'file',
    'signed-user',
    'signed-account-row',
    null,
    expect.any(Number),
    'signed-user',
    0,
  )
  publicRole = 'reader'
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(403)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('issues public room grants for anonymous identities and bounds public HTTP quota', async () => {
  const grant = await publicRealtimeGrant(
    request(),
    bindings,
    { fileId: 'file' },
    'anonymous:visitor',
  )
  expect(grant).toMatchObject({
    userId: 'anonymous:visitor',
    accountId: 'anonymous:visitor',
    publicAccess: true,
    readOnly: false,
  })
  expect(JSON.stringify(grant)).not.toContain('private-publisher-token')
  permitPublicHttp.mockResolvedValue(false)
  expect((await handlePublicDrive(request(), bindings)).status).toBe(429)
})

it('withdraws exact-account publisher registrations before disconnecting visitors', async () => {
  const response = await handlePublicDrive(
    new Request(`${origin}/api/public-drive/disconnect`, {
      method: 'POST',
      headers: { Origin: origin },
    }),
    bindings,
  )
  expect(response.status).toBe(200)
  expect(bind).toHaveBeenCalledWith('signed-user')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(invalidateAnonymousGrants).toHaveBeenCalledTimes(1)
})

it('requires a live app session before withdrawing publishers', async () => {
  auth.getSession.mockResolvedValue(null)
  const response = await handlePublicDrive(
    new Request(`${origin}/api/public-drive/disconnect`, {
      method: 'POST',
      headers: { Origin: origin },
    }),
    bindings,
  )
  expect(response.status).toBe(401)
  expect(execute).not.toHaveBeenCalled()
  expect(invalidateAnonymousGrants).not.toHaveBeenCalled()
})

it('rechecks public write permission immediately before uploading queued edits', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let checks = 0
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('/permissions')) {
      checks++
      return Response.json({
        permissions: [
          { type: 'anyone', role: checks === 1 ? 'writer' : 'reader' },
        ],
      })
    }
    return originalFetch(input, init)
  })
  const response = await handlePublicDrive(
    request(
      'content',
      {
        method: 'PUT',
        body: 'PK queued edits',
        headers: { 'If-Match': '"old"' },
      },
      '&filename=example.concept',
    ),
    bindings,
  )
  expect(response.status).toBe(403)
  expect(uploaded).toBeUndefined()
  expect(invalidateAnonymousGrants).toHaveBeenCalledWith(true)
})

it('does not infer anonymous content access from ambiguous limited-access ACLs', async () => {
  inheritedPermissionsDisabled = true
  expect((await handlePublicDrive(request(), bindings)).status).toBe(403)
  expect(uploaded).toBeUndefined()
})

it('does not finish public authorization or publish after publisher withdrawal during a delayed permission check', async () => {
  let release!: () => void
  let began!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    began = resolve
  })
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('/permissions')) {
      began()
      await delayed
    }
    return originalFetch(input, init)
  })
  const pending = handlePublicDrive(
    request(
      'content',
      { method: 'PUT', body: 'PK pending', headers: { 'If-Match': '"old"' } },
      '&filename=example.concept',
    ),
    bindings,
  )
  await entered
  const disconnect = await handlePublicDrive(
    new Request(`${origin}/api/public-drive/disconnect`, {
      method: 'POST',
      headers: { Origin: origin },
    }),
    bindings,
  )
  expect(disconnect.status).toBe(200)
  first.mockResolvedValue(null)
  release()
  expect((await pending).status).toBe(404)
  expect(uploaded).toBeUndefined()
})

it('does not mint a public room grant after publisher consent changes while Drive responds', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    if (String(input).includes('/permissions'))
      first.mockResolvedValue({ ...publisher, consentVersion: 2 })
    return response
  })
  await expect(
    publicRealtimeGrant(
      request(),
      bindings,
      { fileId: 'file' },
      'anonymous:visitor',
    ),
  ).rejects.toMatchObject({ status: 404 })
})

it('accepts an unchanged publisher relation refreshed while authorization is in flight', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    if (String(input).includes('/permissions'))
      first.mockResolvedValue({ ...publisher, updatedAt: Date.now() })
    return response
  })
  await expect(
    publicRealtimeGrant(
      request(),
      bindings,
      { fileId: 'file' },
      'anonymous:visitor',
    ),
  ).resolves.toMatchObject({ publicAccess: true, publicEpoch: 0 })
})

it('reports registry setup failures without logging secrets or document identities', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    first.mockRejectedValueOnce(
      new Error('private-file-id private-publisher-token missing table'),
    )
    const response = await handlePublicDrive(
      request('register', { method: 'POST' }),
      bindings,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'publisherRegistryUnavailable', stage: 'registry_read' },
    })
    const logged = JSON.stringify(warning.mock.calls)
    expect(logged).toContain('registry_read')
    expect(logged).not.toContain('private-file-id')
    expect(logged).not.toContain('private-publisher-token')
  } finally {
    warning.mockRestore()
  }
})

it('distinguishes provider metadata and permission failures from ordinary private sharing', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  try {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 400 }))
    const invalidFields = await handlePublicDrive(
      request('register', { method: 'POST' }),
      bindings,
    )
    expect(await invalidFields.json()).toMatchObject({
      error: { stage: 'metadata', providerStatus: 400 },
    })
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).includes('/permissions')
        ? new Response(null, { status: 403 })
        : originalFetch(input, init),
    )
    const permissions = await handlePublicDrive(
      request('register', { method: 'POST' }),
      bindings,
    )
    expect(await permissions.json()).toMatchObject({
      error: {
        code: 'publisherPermissionCheckFailed',
        stage: 'permissions',
        providerStatus: 403,
      },
    })
    vi.mocked(fetch).mockImplementation(originalFetch)
    publicRole = undefined
    warning.mockClear()
    const privateFile = await handlePublicDrive(
      request('register', { method: 'POST' }),
      bindings,
    )
    expect(privateFile.status).toBe(404)
    expect(await privateFile.json()).toMatchObject({
      error: { code: 'publicSharingNotEnabled' },
    })
    expect(warning).not.toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})

it('registers portable .concept packages uploaded with generic binary MIME while denying unrelated files', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let mimeType = 'application/octet-stream'
  let name = 'portable.concept'
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    const url = new URL(String(input))
    if (url.pathname === '/drive/v3/files/file') {
      const metadata = (await response.json()) as Record<string, unknown>
      return Response.json({ ...metadata, mimeType, name })
    }
    return response
  })
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(200)
  mimeType = 'application/zip'
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(200)
  name = 'unrelated.zip'
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(404)
  name = 'native.concept'
  mimeType = 'application/vnd.google-apps.document'
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(404)
})

it('reports the precise registration policy denial with safe linked-account observations', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let securityUpdateEligible = false
  let capability: 'canDownload' | 'canEdit' | 'canModifyContent' | undefined =
    'canDownload'
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    if (new URL(String(input)).pathname === '/drive/v3/files/file') {
      const file = (await response.json()) as {
        capabilities: Record<string, boolean>
      }
      return Response.json({
        ...file,
        capabilities: {
          ...file.capabilities,
          ...(capability ? { [capability]: false } : {}),
        },
        linkShareMetadata: {
          securityUpdateEligible,
          securityUpdateEnabled: true,
        },
      })
    }
    return response
  })
  const denied = await handlePublicDrive(
    request('register', { method: 'POST' }),
    bindings,
  )
  expect(denied.status).toBe(403)
  expect(await denied.json()).toMatchObject({
    error: {
      policyReason: 'publisherCannotDownload',
      diagnostics: {
        canDownload: false,
        canEdit: true,
        canModifyContent: true,
        securityUpdateEligible: false,
        securityUpdateEnabled: true,
        resourceKeyPresent: false,
      },
    },
  })
  capability = 'canEdit'
  expect(
    await (
      await handlePublicDrive(request('register', { method: 'POST' }), bindings)
    ).json(),
  ).toMatchObject({ error: { policyReason: 'publisherCannotEdit' } })
  capability = 'canModifyContent'
  expect(
    await (
      await handlePublicDrive(request('register', { method: 'POST' }), bindings)
    ).json(),
  ).toMatchObject({ error: { policyReason: 'publisherCannotModifyContent' } })
  capability = undefined
  securityUpdateEligible = true
  const missingKey = await handlePublicDrive(
    request('register', { method: 'POST' }),
    bindings,
  )
  expect(await missingKey.json()).toMatchObject({
    error: {
      policyReason: 'resourceKeyUnavailable',
      diagnostics: {
        securityUpdateEligible: true,
        securityUpdateEnabled: true,
        resourceKeyPresent: false,
        publicRole: 'writer',
      },
    },
  })
})

it('does not require a nonexistent resource key for an explicitly ineligible public file', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let eligibility: boolean | undefined = false
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    if (new URL(String(input)).pathname === '/drive/v3/files/file') {
      return Response.json({
        ...(await response.json()),
        linkShareMetadata: {
          securityUpdateEligible: eligibility,
          securityUpdateEnabled: true,
        },
      })
    }
    return response
  })
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(200)
  expect((await handlePublicDrive(request('metadata'), bindings)).status).toBe(
    200,
  )
  eligibility = true
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(403)
  expect((await handlePublicDrive(request('metadata'), bindings)).status).toBe(
    404,
  )
  eligibility = undefined
  expect(
    (await handlePublicDrive(request('register', { method: 'POST' }), bindings))
      .status,
  ).toBe(403)
  expect((await handlePublicDrive(request('metadata'), bindings)).status).toBe(
    404,
  )
})
