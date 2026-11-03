import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getGoogleDriveToken,
  GoogleDriveAuthError,
  invalidateGoogleDriveToken,
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
  getGoogleDriveToken: vi.fn(() => 'test-token'),
  invalidateGoogleDriveToken: vi.fn(),
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
  vi.mocked(getGoogleDriveToken).mockReturnValue('test-token')
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

it('fails closed when Drive omits the response ETag', async () => {
  fetchMock.mockResolvedValueOnce(metadata())
  await expect(readConceptFile('drive-id')).rejects.toThrow(
    'Safe syncing is unavailable',
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('creates in the selected folder and invalidates revoked tokens', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"created"'))
  await createConceptFile('Test', '{}', 'folder-id')
  const body = await (fetchMock.mock.calls[0][1]?.body as NodeBlob).text()
  expect(body).toContain('"parents":[{"id":"folder-id"}]')
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
  await expect(listConceptFiles()).rejects.toBeInstanceOf(GoogleDriveAuthError)
  expect(invalidateGoogleDriveToken).toHaveBeenCalledOnce()
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

it('retries a late 401 with the replacement token without disconnecting it', async () => {
  vi.mocked(getGoogleDriveToken)
    .mockReturnValueOnce('old-token')
    .mockReturnValue('replacement-token')
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ files: [file] })))
  await expect(listConceptFiles()).resolves.toEqual([file])
  expect(invalidateGoogleDriveToken).not.toHaveBeenCalled()
  expect(
    new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization'),
  ).toBe('Bearer replacement-token')
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
  controller.abort()
  await rejected
  expect(fetchMock).toHaveBeenCalledOnce()
})
