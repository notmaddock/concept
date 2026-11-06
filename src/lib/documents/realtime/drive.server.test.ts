import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDriveCapabilities } from './drive.server'

function stubFetch(status: number, body?: object) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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
