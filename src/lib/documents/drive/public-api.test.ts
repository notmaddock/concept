import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getFileMetadata,
  readConceptFile,
  updateConceptFile,
  registerPublicDriveFile,
} from './api'

const auth = vi.hoisted(() => ({
  connected: false,
  token: vi.fn(async () => 'private-token'),
}))
vi.mock('./auth', () => ({
  isGoogleDriveConnected: () => auth.connected,
  getGoogleDriveToken: auth.token,
  invalidateGoogleDriveSession: vi.fn(),
  GoogleDriveAuthError: class extends Error {},
}))
const fetchMock = vi.fn<typeof fetch>()
const metadata = (id: string, etag = '"public-version"') =>
  new Response(
    JSON.stringify({
      id,
      title: 'Shared.concept',
      mimeType: 'application/vnd.concept+zip',
      etag,
      capabilities: {
        canEdit: true,
        canModifyContent: true,
        canDownload: true,
      },
    }),
  )

beforeEach(() => {
  auth.connected = false
  auth.token.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

it('opens and conditionally publishes a public document without Google sign-in or a picker', async () => {
  fetchMock.mockResolvedValueOnce(metadata('anonymous-document'))
  const version = await getFileMetadata('anonymous-document')
  expect(fetchMock.mock.calls[0][0]).toBe(
    '/api/public-drive/metadata?fileId=anonymous-document',
  )
  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
  fetchMock.mockResolvedValueOnce(metadata('anonymous-document'))
  const file = await readConceptFile('anonymous-document', undefined, version)
  expect(file.content).toEqual(new Uint8Array([1, 2, 3]))
  fetchMock.mockResolvedValueOnce(metadata('anonymous-document', '"published"'))
  const saved = await updateConceptFile(
    'anonymous-document',
    'Shared',
    new Uint8Array([1, 2, 3]),
    version.etag,
  )
  expect(saved.etag).toBe('"published"')
  const [url, options] = fetchMock.mock.calls.at(-1)!
  expect(url).toBe(
    '/api/public-drive/content?fileId=anonymous-document&filename=Shared.concept',
  )
  expect(options?.method).toBe('PUT')
  expect(new Headers(options?.headers).get('If-Match')).toBe('"public-version"')
  expect(auth.token).not.toHaveBeenCalled()
})

it('falls back to public link access when drive.file has not granted picker access', async () => {
  auth.connected = true
  fetchMock.mockResolvedValueOnce(
    Response.json(
      { error: { errors: [{ reason: 'notFound' }] } },
      { status: 404 },
    ),
  )
  fetchMock.mockResolvedValueOnce(metadata('not-picked'))
  await expect(getFileMetadata('not-picked')).resolves.toMatchObject({
    etag: '"public-version"',
  })
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
    '/api/public-drive/metadata?fileId=not-picked',
  )
})

it('registers only through the same-origin authenticated publisher endpoint', async () => {
  await registerPublicDriveFile('publisher-file')
  expect(fetchMock).not.toHaveBeenCalled()
  auth.connected = true
  fetchMock.mockResolvedValueOnce(Response.json({ registered: true }))
  await registerPublicDriveFile('publisher-file')
  expect(fetchMock.mock.calls[0][0]).toBe(
    '/api/public-drive/register?fileId=publisher-file',
  )
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
  })
})

it('keeps denied public files blocked and preserves conditional upload conflicts', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }))
  await expect(getFileMetadata('private-file')).rejects.toMatchObject({
    status: 403,
  })
  fetchMock.mockResolvedValueOnce(metadata('conflicted-public'))
  await getFileMetadata('conflicted-public')
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 412 }))
  await expect(
    updateConceptFile(
      'conflicted-public',
      'Shared',
      new Uint8Array([1]),
      '"old"',
    ),
  ).rejects.toMatchObject({ status: 412 })
})
