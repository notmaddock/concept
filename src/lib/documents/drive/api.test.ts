import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getGoogleDriveToken,
  GoogleDriveAuthError,
  invalidateGoogleDriveSession,
} from './auth'
import {
  createConceptFile,
  DriveCreatedFileError,
  DriveError,
  listConceptFiles,
  readConceptFile,
  trashConceptFile,
  updateConceptFile,
} from './api'

vi.mock('./auth', () => ({
  getGoogleDriveToken: vi.fn(async () => 'test-token'),
  invalidateGoogleDriveSession: vi.fn(),
  GoogleDriveAuthError: class extends Error {},
}))

const file = {
  id: 'drive-id',
  name: 'Test.concept',
  mimeType: 'application/vnd.concept+json',
}
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Blob', NodeBlob)
  fetchMock.mockReset()
  vi.clearAllMocks()
  vi.mocked(getGoogleDriveToken).mockResolvedValue('test-token')
})

afterEach(() => vi.unstubAllGlobals())

function metadata(etag?: string) {
  return new Response(
    JSON.stringify({
      id: file.id,
      title: file.name,
      mimeType: file.mimeType,
      etag,
    }),
  )
}

it('uploads content and metadata atomically with the supplied If-Match', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"next"'))
  await expect(
    updateConceptFile('drive-id', 'Renamed', '{"data":1}', '"base"'),
  ).resolves.toEqual({ file, etag: '"next"' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain(
    '/upload/drive/v2/files/drive-id?uploadType=multipart',
  )
  expect(init?.method).toBe('PUT')
  expect(new Headers(init?.headers).get('If-Match')).toBe('"base"')
  expect(String(url)).toMatch(/^https:\/\/www.googleapis.com\//)
  expect(init?.credentials).toBe('omit')
  expect(new Headers(init?.headers).get('Authorization')).toBe(
    'Bearer test-token',
  )
  const body = await (init?.body as NodeBlob).text()
  expect(body).toContain('"title":"Renamed.concept"')
  expect(body).toContain('{"data":1}')
})

it('preserves an explicit raw Drive filename without adding an extension', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"next"'))
  await updateConceptFile(
    'drive-id',
    'Display name',
    '{}',
    '"base"',
    'Externally renamed',
  )
  const body = await (fetchMock.mock.calls[0][1]?.body as NodeBlob).text()
  expect(body).toContain('"title":"Externally renamed"')
  expect(body).not.toContain('Externally renamed.concept')
})

it('never uploads without a strong ETag and preserves conflict status', async () => {
  await expect(
    updateConceptFile('drive-id', 'Test', '{}', ''),
  ).rejects.toBeInstanceOf(DriveError)
  await expect(
    updateConceptFile('drive-id', 'Test', '{}', 'W/"weak"'),
  ).rejects.toThrow('strong ETag')
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 412 }))
  await expect(
    updateConceptFile('drive-id', 'Test', '{}', '"stale"'),
  ).rejects.toMatchObject({ status: 412 })
})

it('retries a download whose validator changed during reading', async () => {
  fetchMock
    .mockResolvedValueOnce(metadata('"old"'))
    .mockResolvedValueOnce(new Response('old-content'))
    .mockResolvedValueOnce(metadata('"new"'))
    .mockResolvedValueOnce(metadata('"new"'))
    .mockResolvedValueOnce(new Response('new-content'))
    .mockResolvedValueOnce(metadata('"new"'))
  await expect(readConceptFile('drive-id')).resolves.toEqual({
    file,
    etag: '"new"',
    content: 'new-content',
  })
})

it('reuses supplied metadata before download while verifying the final validator', async () => {
  const initial = { file, etag: '"checked"' }
  fetchMock
    .mockResolvedValueOnce(new Response('content'))
    .mockResolvedValueOnce(metadata(initial.etag))
  await expect(
    readConceptFile('drive-id', undefined, initial),
  ).resolves.toEqual({ ...initial, content: 'content' })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(String(fetchMock.mock.calls[0][0])).toContain(
    '/drive/v3/files/drive-id?alt=media',
  )
  expect(String(fetchMock.mock.calls[1][0])).toContain(
    '/drive/v2/files/drive-id?fields=',
  )
})

it('discards stale supplied metadata and reads fresh metadata on download retry', async () => {
  const initial = { file, etag: '"stale"' }
  fetchMock
    .mockResolvedValueOnce(new Response('stale-content'))
    .mockResolvedValueOnce(metadata('"changed"'))
    .mockResolvedValueOnce(metadata('"fresh"'))
    .mockResolvedValueOnce(new Response('fresh-content'))
    .mockResolvedValueOnce(metadata('"fresh"'))
  await expect(
    readConceptFile('drive-id', undefined, initial),
  ).resolves.toEqual({ file, etag: '"fresh"', content: 'fresh-content' })
  expect(fetchMock).toHaveBeenCalledTimes(5)
  expect(String(fetchMock.mock.calls[2][0])).toContain(
    '/drive/v2/files/drive-id?fields=',
  )
  expect(String(fetchMock.mock.calls[3][0])).toContain(
    '/drive/v3/files/drive-id?alt=media',
  )
})

it('fails closed when Drive omits the response ETag', async () => {
  fetchMock.mockResolvedValueOnce(metadata())
  await expect(readConceptFile('drive-id')).rejects.toThrow(
    'Safe syncing is unavailable',
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('creates in the selected folder and rejects credentials still invalid after refresh', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"created"'))
  await createConceptFile('Test', '{}', 'folder-id')
  const body = await (fetchMock.mock.calls[0][1]?.body as NodeBlob).text()
  expect(body).toContain('"parents":[{"id":"folder-id"}]')
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
  await expect(listConceptFiles()).rejects.toBeInstanceOf(GoogleDriveAuthError)
  expect(invalidateGoogleDriveSession).toHaveBeenCalledOnce()
})

it('filters matching names by exact file extension', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        files: [
          file,
          { ...file, mimeType: 'text/plain', name: 'test.concept.backup' },
        ],
      }),
    ),
  )
  await expect(listConceptFiles()).resolves.toEqual([file])
})

it('trashes with a fresh validator and leaves conflicts for the caller', async () => {
  fetchMock
    .mockResolvedValueOnce(metadata('"fresh"'))
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
  await expect(trashConceptFile('drive-id')).rejects.toMatchObject({
    status: 412,
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const init = fetchMock.mock.calls[1][1]
  expect(new Headers(init?.headers).get('If-Match')).toBe('"fresh"')
  expect(init?.body).toBe('{"labels":{"trashed":true}}')
})

it('retains the created file identity when its validator is missing', async () => {
  fetchMock.mockResolvedValueOnce(metadata())
  const created = createConceptFile('Test', '{}')
  await expect(created).rejects.toBeInstanceOf(DriveCreatedFileError)
  await expect(created).rejects.toMatchObject({ file })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('refreshes a Google-rejected token once and replays the identical conditional upload', async () => {
  let token = 'old-token'
  vi.mocked(getGoogleDriveToken).mockImplementation(async (options) => {
    if (options?.forceRefresh) token = 'new-token'
    return token
  })
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(metadata('"saved"'))
  await updateConceptFile('drive-id', 'Test', '{}', '"base"')
  expect(getGoogleDriveToken).toHaveBeenCalledWith(
    expect.objectContaining({ forceRefresh: true }),
  )
  expect(invalidateGoogleDriveSession).not.toHaveBeenCalled()
  const first = fetchMock.mock.calls[0][1]
  const second = fetchMock.mock.calls[1][1]
  expect(second?.body).toBe(first?.body)
  expect(new Headers(second?.headers).get('If-Match')).toBe('"base"')
  expect(new Headers(second?.headers).get('Authorization')).toBe(
    'Bearer new-token',
  )
  expect(second?.credentials).toBe('omit')
})

it('uses a token already refreshed by another request after a late Google 401', async () => {
  vi.mocked(getGoogleDriveToken)
    .mockResolvedValueOnce('old-token')
    .mockResolvedValue('new-token')
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ files: [file] })))
  await expect(listConceptFiles()).resolves.toEqual([file])
  expect(getGoogleDriveToken).not.toHaveBeenCalledWith(
    expect.objectContaining({ forceRefresh: true }),
  )
})

it('preserves the app session when broker refresh temporarily fails', async () => {
  vi.mocked(getGoogleDriveToken).mockImplementation(async (options) => {
    if (options?.forceRefresh)
      throw new Error('Google Drive is temporarily unavailable.')
    return 'test-token'
  })
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
  await expect(listConceptFiles()).rejects.toThrow('temporarily unavailable')
  expect(invalidateGoogleDriveSession).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('cancels document downloads when their owning session stops', async () => {
  const controller = new AbortController()
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        )
      }),
  )
  const download = readConceptFile('drive-id', controller.signal)
  const rejected = expect(download).rejects.toMatchObject({
    name: 'AbortError',
  })
  await Promise.resolve()
  controller.abort()
  await rejected
  expect(fetchMock).toHaveBeenCalledOnce()
})
