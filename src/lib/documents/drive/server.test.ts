// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { applyUpdate, Doc } from 'yjs'
import { initializeDocument } from '../initial-document'
import { parseConcept, serializeConcept } from '../concept-file'
import {
  listDriveDocuments,
  readDriveDocument,
  saveDriveDocument,
} from './server'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  session: vi.fn(),
  accounts: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock('#/lib/auth/server', () => ({
  getProviderAccessToken: mocks.token,
  getAuth: () => ({
    api: { getSession: mocks.session, listUserAccounts: mocks.accounts },
  }),
}))
const id = '0aad2d15-507a-43ca-8a04-e194484002a3'
const headers = new Headers()
const metadata = {
  id: 'drive-file',
  name: 'Remote.concept',
  modifiedTime: '2026-10-23T12:00:00Z',
  appProperties: { conceptId: id },
}
function json(value: unknown, etag = '"revision-1"') {
  return new Response(JSON.stringify(value), { headers: { etag } })
}
function content(name = 'Remote') {
  const doc = new Doc()
  initializeDocument(doc)
  const text = serializeConcept(name, doc)
  doc.destroy()
  return text
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.session.mockResolvedValue({ user: { id: 'user' } })
  mocks.accounts.mockResolvedValue([
    { id: 'account', providerId: 'google', driveConnected: true },
  ])
  mocks.token.mockResolvedValue({ accessToken: 'secret-token' })
})
it('requires a session before listing and never contacts Drive on failed authorization', async () => {
  mocks.session.mockResolvedValue(null)
  await expect(listDriveDocuments(headers)).rejects.toThrow('Sign in')
  expect(mocks.fetch).not.toHaveBeenCalled()
  mocks.token.mockRejectedValue(new Error('Connection not found'))
  await expect(
    readDriveDocument(headers, 'someone-else', 'file'),
  ).rejects.toThrow('Connection not found')
  expect(mocks.fetch).not.toHaveBeenCalled()
})

it('lists all pages with separate Concept and backing identities and no tokens', async () => {
  mocks.fetch
    .mockResolvedValueOnce(json({ files: [metadata], nextPageToken: 'next' }))
    .mockResolvedValueOnce(
      json({ files: [{ ...metadata, id: 'other', appProperties: {} }] }),
    )
  const documents = await listDriveDocuments(headers)
  expect(documents).toEqual([
    {
      id,
      name: 'Remote',
      updatedAt: Date.parse(metadata.modifiedTime),
      backing: {
        provider: 'google-drive',
        fileId: 'drive-file',
        accountId: 'account',
        syncedName: 'Remote',
      },
    },
  ])
  expect(mocks.fetch.mock.calls[1][0]).toContain('pageToken=next')
  expect(JSON.stringify(documents)).not.toContain('secret-token')
})

it('creates a versioned Concept file with independent app identity', async () => {
  mocks.fetch.mockResolvedValue(json(metadata))
  const result = await saveDriveDocument(headers, {
    id,
    name: 'Remote',
    text: content(),
  })
  expect(result.document.id).toBe(id)
  expect(result.document.backing?.fileId).toBe('drive-file')
  const [url, init] = mocks.fetch.mock.calls[0]
  expect(url).toContain('uploadType=multipart')
  expect(init.method).toBe('POST')
  expect(init.body).toContain(`"conceptId":"${id}"`)
  expect(init.body).toContain('"version":1')
})

it('merges remote and local Yjs changes and conditionally updates the same Drive file', async () => {
  const local = new Doc()
  initializeDocument(local)
  const remote = new Doc()
  const initial = parseConcept(serializeConcept('Remote', local))
  applyUpdate(
    remote,
    Uint8Array.from(atob(initial.update), (character) =>
      character.charCodeAt(0),
    ),
  )
  local.getMap('metadata').set('local', 'kept')
  remote.getMap('metadata').set('remote', 'kept')
  mocks.fetch
    .mockResolvedValueOnce(json(metadata))
    .mockResolvedValueOnce(new Response(serializeConcept('Remote', remote)))
    .mockResolvedValueOnce(json(metadata))
  const result = await saveDriveDocument(headers, {
    id,
    accountId: 'account',
    fileId: 'drive-file',
    name: 'Remote',
    text: serializeConcept('Remote', local),
  })
  const merged = new Doc()
  applyUpdate(
    merged,
    Uint8Array.from(atob(result.file.update), (character) =>
      character.charCodeAt(0),
    ),
  )
  expect(merged.getMap('metadata').toJSON()).toMatchObject({
    local: 'kept',
    remote: 'kept',
  })
  expect(mocks.fetch.mock.calls[2][0]).toContain(
    '/drive-file?uploadType=multipart',
  )
  expect(mocks.fetch.mock.calls[2][1]).toMatchObject({
    method: 'PATCH',
    headers: { 'If-Match': '"revision-1"' },
  })
  local.destroy()
  remote.destroy()
  merged.destroy()
})

it('refuses to overwrite a mismatched identity', async () => {
  mocks.fetch
    .mockResolvedValueOnce(
      json({ ...metadata, appProperties: { conceptId: 'different' } }),
    )
    .mockResolvedValueOnce(new Response(content()))
  await expect(
    saveDriveDocument(headers, {
      id,
      accountId: 'account',
      fileId: 'drive-file',
      name: 'Remote',
      text: content(),
    }),
  ).rejects.toThrow('different Concept document')
  expect(mocks.fetch).toHaveBeenCalledTimes(2)
})

it('surfaces expired access, invalid files, and revision conflicts', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 403 }))
  await expect(readDriveDocument(headers, 'account', 'file')).rejects.toThrow(
    'Reconnect',
  )
  mocks.fetch
    .mockResolvedValueOnce(json(metadata))
    .mockResolvedValueOnce(new Response('invalid'))
  await expect(readDriveDocument(headers, 'account', 'file')).rejects.toThrow(
    'supported .concept',
  )
  mocks.fetch
    .mockResolvedValueOnce(json(metadata))
    .mockResolvedValueOnce(new Response('', { status: 412 }))
  await expect(readDriveDocument(headers, 'account', 'file')).rejects.toThrow(
    'changed during saving',
  )
})

// Actual Drive v3 metadata may omit ETag even after a successful file creation.

it('opens and updates an existing Drive file without an ETag header', async () => {
  const file = content()
  const noEtag = (value: unknown) => new Response(JSON.stringify(value))
  mocks.fetch
    .mockResolvedValueOnce(noEtag({ ...metadata, version: '1' }))
    .mockResolvedValueOnce(new Response(file))
    .mockResolvedValueOnce(noEtag({ version: '1' }))
  await expect(
    readDriveDocument(headers, 'account', 'drive-file'),
  ).resolves.toMatchObject({ document: { id } })
  mocks.fetch
    .mockReset()
    .mockResolvedValueOnce(noEtag({ ...metadata, version: '1' }))
    .mockResolvedValueOnce(new Response(file))
    .mockResolvedValueOnce(noEtag({ version: '1' }))
    .mockResolvedValueOnce(noEtag({ ...metadata, version: '2' }))
  await expect(
    saveDriveDocument(headers, {
      id,
      accountId: 'account',
      fileId: 'drive-file',
      name: 'Remote',
      text: file,
    }),
  ).resolves.toMatchObject({ document: { id } })
  expect(mocks.fetch.mock.calls[3][1].method).toBe('PATCH')
  expect(mocks.fetch.mock.calls[3][1].headers).not.toHaveProperty('If-Match')
})

it('retries instead of uploading if the Drive version changes while downloading', async () => {
  mocks.fetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...metadata, version: '1' })),
    )
    .mockResolvedValueOnce(new Response(content()))
    .mockResolvedValueOnce(json({ version: '2' }))
  await expect(
    saveDriveDocument(headers, {
      id,
      accountId: 'account',
      fileId: 'drive-file',
      name: 'Remote',
      text: content(),
    }),
  ).rejects.toThrow('changed during saving')
  expect(mocks.fetch).toHaveBeenCalledTimes(3)
  expect(mocks.fetch.mock.calls.every(([, init]) => !init.method)).toBe(true)
})

it('authorizes uploads before decoding and hydrating the supplied document', async () => {
  mocks.token.mockRejectedValue(
    new Error('Sign in to use a storage connection.'),
  )
  await expect(
    saveDriveDocument(headers, {
      id,
      accountId: 'account',
      name: 'Long',
      text: 'not a Concept file',
    }),
  ).rejects.toThrow('Sign in')
  expect(mocks.fetch).not.toHaveBeenCalled()
})
