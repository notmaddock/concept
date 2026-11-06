import { packageLimits } from '../limits'
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
  getFileMetadata,
  isDriveFileReadOnly,
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
const bytes = (text: string) => new TextEncoder().encode(text)

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
    updateConceptFile('drive-id', 'Renamed', bytes('{"data":1}'), '"base"'),
  ).resolves.toEqual({ file, etag: '"next"' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain(
    '/upload/drive/v2/files/drive-id?uploadType=multipart',
  )
  expect(init?.method).toBe('PUT')
  expect(new Headers(init?.headers).get('If-Match')).toBe('"base"')
  expect(new URL(String(url)).origin).toBe('https://www.googleapis.com')
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
    bytes('{}'),
    '"base"',
    'Externally renamed',
  )
  const body = await (fetchMock.mock.calls[0][1]?.body as NodeBlob).text()
  expect(body).toContain('"title":"Externally renamed"')
  expect(body).not.toContain('Externally renamed.concept')
})

it('never uploads without a strong ETag and preserves conflict status', async () => {
  await expect(
    updateConceptFile('drive-id', 'Test', bytes('{}'), ''),
  ).rejects.toBeInstanceOf(DriveError)
  await expect(
    updateConceptFile('drive-id', 'Test', bytes('{}'), 'W/"weak"'),
  ).rejects.toThrow('strong ETag')
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 412 }))
  await expect(
    updateConceptFile('drive-id', 'Test', bytes('{}'), '"stale"'),
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
    content: new TextEncoder().encode('new-content'),
  })
})

it('reuses supplied metadata before download while verifying the final validator', async () => {
  const initial = { file, etag: '"checked"' }
  fetchMock
    .mockResolvedValueOnce(new Response('content'))
    .mockResolvedValueOnce(metadata(initial.etag))
  await expect(
    readConceptFile('drive-id', undefined, initial),
  ).resolves.toEqual({
    ...initial,
    content: new TextEncoder().encode('content'),
  })
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
  ).resolves.toEqual({
    file,
    etag: '"fresh"',
    content: new TextEncoder().encode('fresh-content'),
  })
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
  await createConceptFile('Test', bytes('{}'), 'folder-id')
  const body = await (fetchMock.mock.calls[0][1]?.body as NodeBlob).text()
  expect(body).toContain('"parents":[{"id":"folder-id"}]')
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
  await expect(listConceptFiles()).rejects.toBeInstanceOf(GoogleDriveAuthError)
  expect(invalidateGoogleDriveSession).toHaveBeenCalledOnce()
})

it('paginates concept files across pages and filters matching names by exact extension', async () => {
  const secondFile = { ...file, id: 'drive-id-2', name: 'Second.concept' }
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            file,
            { ...file, mimeType: 'text/plain', name: 'test.concept.backup' },
          ],
          nextPageToken: 'page-2',
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [secondFile],
        }),
      ),
    )
  await expect(listConceptFiles()).resolves.toEqual([file, secondFile])
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=page-2')
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
  const created = createConceptFile('Test', bytes('{}'))
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
  await updateConceptFile('drive-id', 'Test', bytes('{}'), '"base"')
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

it('requests content capabilities and shared-drive support when opening a file', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"base"'))
  await getFileMetadata('shared-drive-file')
  const url = new URL(String(fetchMock.mock.calls[0][0]))
  expect(url.searchParams.get('supportsAllDrives')).toBe('true')
  expect(url.searchParams.get('fields')).toContain('canModifyContent')
  expect(
    isDriveFileReadOnly({
      ...file,
      capabilities: { canEdit: true, canModifyContent: false },
    }),
  ).toBe(true)
})

it('includes shared-drive files in library listings', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
  await listConceptFiles()
  const url = new URL(String(fetchMock.mock.calls[0][0]))
  expect(url.searchParams.get('supportsAllDrives')).toBe('true')
  expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true')
})

it('uploads exact binary media and changes the legacy MIME type in the same conditional write', async () => {
  fetchMock.mockResolvedValueOnce(metadata('"next"'))
  const content = new Uint8Array([0x50, 0x4b, 0, 0xff, 0x80, 0x0d, 0x0a])
  await updateConceptFile('drive-id', 'Binary', content, '"base"')
  const init = fetchMock.mock.calls[0][1]
  const body = new Uint8Array(await (init?.body as NodeBlob).arrayBuffer())
  const text = new TextDecoder().decode(body)
  expect(text).toContain('"mimeType":"application/vnd.concept+zip"')
  expect(text).toContain('Content-Type: application/vnd.concept+zip\r\n\r\n')
  expect(text).not.toContain('application/vnd.concept+zip; charset')
  const mediaStart = new TextEncoder().encode(
    text.slice(0, text.indexOf('PK')),
  ).length
  expect(body.slice(mediaStart, mediaStart + content.length)).toEqual(content)
  expect(new Headers(init?.headers).get('If-Match')).toBe('"base"')
})

it('reads exact binary bytes without text decoding', async () => {
  const content = new Uint8Array([0, 255, 128, 80, 75])
  fetchMock
    .mockResolvedValueOnce(metadata('"base"'))
    .mockResolvedValueOnce(new Response(content))
    .mockResolvedValueOnce(metadata('"base"'))
  await expect(readConceptFile('drive-id')).resolves.toMatchObject({ content })
})

it('discovers both legacy and package MIME types without requiring a filename extension', async () => {
  const zip = {
    ...file,
    id: 'zip',
    name: 'Binary',
    mimeType: 'application/vnd.concept+zip',
  }
  const legacy = { ...file, name: 'Legacy' }
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ files: [zip, legacy] })),
  )
  await expect(listConceptFiles()).resolves.toEqual([zip, legacy])
  const query = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get(
    'q',
  )
  expect(query).toContain("mimeType = 'application/vnd.concept+zip'")
  expect(query).toContain("mimeType = 'application/vnd.concept+json'")
})

it('bounds streamed media even when content length is absent and cancels oversized reads', async () => {
  const previous = packageLimits.packageBytes
  packageLimits.packageBytes = 4
  const cancelled = vi.fn()
  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5]))
      },
      cancel: cancelled,
    })
    fetchMock
      .mockResolvedValueOnce(metadata('"base"'))
      .mockResolvedValueOnce(new Response(body))
    await expect(readConceptFile('drive-id')).rejects.toMatchObject({
      status: 413,
    })
    expect(cancelled).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  } finally {
    packageLimits.packageBytes = previous
  }
})

it('rejects oversized declared media before consuming the body or making an upload', async () => {
  const previous = packageLimits.packageBytes
  packageLimits.packageBytes = 4
  const cancelled = vi.fn()
  try {
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    fetchMock
      .mockResolvedValueOnce(metadata('"base"'))
      .mockResolvedValueOnce(
        new Response(body, { headers: { 'Content-Length': '5' } }),
      )
    await expect(readConceptFile('drive-id')).rejects.toMatchObject({
      status: 413,
    })
    expect(cancelled).toHaveBeenCalledOnce()
    fetchMock.mockClear()
    await expect(
      updateConceptFile('drive-id', 'Large', new Uint8Array(5), '"base"'),
    ).rejects.toMatchObject({ status: 413 })
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    packageLimits.packageBytes = previous
  }
})
