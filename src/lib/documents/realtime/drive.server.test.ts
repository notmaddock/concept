import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDriveVerifier, fetchDriveCapabilities } from './drive.server'
import {
  clearCachedDriveTokenForUser,
  getDriveAccessTokenForUser,
} from './user-token.server'

vi.mock('./user-token.server', () => ({
  getDriveAccessTokenForUser: vi.fn(),
  clearCachedDriveTokenForUser: vi.fn(),
}))

function stubFetch(status: number, body?: object) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Stubs fetch with one response per call, in order. */
function stubFetchSequence(
  responses: Array<{ status: number; body?: object }>,
) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(
      new Response(
        response.body === undefined ? null : JSON.stringify(response.body),
        { status: response.status },
      ),
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const env = {} as Cloudflare.Env
const origin = 'https://app.test'

const editableBody = {
  id: 'file-1',
  capabilities: { canEdit: true, canModifyContent: true, canComment: false },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchDriveCapabilities', () => {
  it('maps a 200 response to DocumentCapabilities', async () => {
    const fetchMock = stubFetch(200, {
      id: 'file-1',
      capabilities: {
        canEdit: true,
        canModifyContent: true,
        canComment: false,
      },
    })
    const caps = await fetchDriveCapabilities('file-1', 'token-1')
    expect(caps).toEqual({ view: true, edit: true, comment: false })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toContain('/drive/v3/files/file-1?')
    expect(url).toContain(
      'fields=id,capabilities(canEdit,canModifyContent,canComment)',
    )
    expect(url).toContain('supportsAllDrives=true')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-1',
    )
  })

  it('maps read-only flags to edit: false', async () => {
    stubFetch(200, {
      capabilities: {
        canEdit: false,
        canModifyContent: true,
        canComment: true,
      },
    })
    await expect(fetchDriveCapabilities('file-1', 'token-1')).resolves.toEqual({
      view: true,
      edit: false,
      comment: true,
    })
  })

  it('encodes the fileId in the URL', async () => {
    const fetchMock = stubFetch(200, { capabilities: { canEdit: true } })
    await fetchDriveCapabilities('a/b c', 'token-1')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/drive/v3/files/a%2Fb%20c?')
  })

  it('returns undefined on 404 and 403', async () => {
    stubFetch(404)
    await expect(
      fetchDriveCapabilities('file-1', 'token-1'),
    ).resolves.toBeUndefined()
    stubFetch(403)
    await expect(
      fetchDriveCapabilities('file-1', 'token-1'),
    ).resolves.toBeUndefined()
  })

  it('throws on other error statuses', async () => {
    stubFetch(500)
    await expect(fetchDriveCapabilities('file-1', 'token-1')).rejects.toThrow(
      'Drive files.get failed with status 500.',
    )
  })
})

describe('createDriveVerifier', () => {
  const getToken = vi.mocked(getDriveAccessTokenForUser)
  const clearToken = vi.mocked(clearCachedDriveTokenForUser)

  beforeEach(() => {
    getToken.mockReset()
    clearToken.mockReset()
    getToken.mockResolvedValue('token-1')
  })

  it('resolves undefined when Drive reports no access (403/404)', async () => {
    const verifier = createDriveVerifier(env, origin)

    stubFetch(403)
    await expect(verifier.verify('file-1', 'user-1')).resolves.toBeUndefined()

    stubFetch(404)
    await expect(verifier.verify('file-1', 'user-1')).resolves.toBeUndefined()

    expect(getToken).toHaveBeenCalledWith(env, origin, 'user-1')
    expect(clearToken).not.toHaveBeenCalled()
  })

  it('rejects on a 500 instead of reporting no access', async () => {
    stubFetch(500)
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).rejects.toThrow(
      'Drive files.get failed with status 500.',
    )
    expect(clearToken).not.toHaveBeenCalled()
  })

  it('rejects when the Drive request fails at the network level', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).rejects.toThrow(
      'fetch failed',
    )
  })

  it('rejects when no access token can be obtained', async () => {
    const fetchMock = stubFetch(200, editableBody)
    getToken.mockRejectedValue(new Error('User has no Google refresh token.'))
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).rejects.toThrow(
      'User has no Google refresh token.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the cached token and retries once after a 401', async () => {
    const fetchMock = stubFetchSequence([
      { status: 401 },
      { status: 200, body: editableBody },
    ])
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).resolves.toEqual({
      view: true,
      edit: true,
      comment: false,
    })
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(clearToken).toHaveBeenCalledWith('user-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenCalledTimes(2)
  })

  it('rejects when the retry after a 401 also fails', async () => {
    const fetchMock = stubFetchSequence([{ status: 401 }, { status: 401 }])
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).rejects.toThrow(
      'Drive files.get failed with status 401.',
    )
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects when the retry after a 401 fails at the network level', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const verifier = createDriveVerifier(env, origin)
    await expect(verifier.verify('file-1', 'user-1')).rejects.toThrow(
      'fetch failed',
    )
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
