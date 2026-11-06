import type * as DriveApi from './drive/api'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  documentStorage,
  recoverDocumentLocally,
  refreshDriveDocuments,
  setDocumentOfflineAvailable,
} from './document-storage'
import { localDocumentStorage } from './storage'
import type { DocumentInfo, DocumentPersistence } from './storage'
import { documentSessions, getSaveStatus } from './sync'
import { initializeDocument } from './initial-document'
import { serializeConcept } from './serialization'
import { snapshotRevision } from './package'
import { captureSnapshot } from './working'
import {
  getFileMetadata,
  registerPublicDriveFile,
  listConceptFiles,
  readConceptFile,
  trashConceptFile,
  updateConceptFile,
} from './drive/api'

const publicFiles = vi.hoisted(() => new Set<string>())
const auth = vi.hoisted(() => {
  class AuthRequired extends Error {}
  return {
    AuthRequired,
    accountId: undefined as string | undefined,
    connected: true,
  }
})

vi.mock('./drive/auth', () => ({
  GoogleDriveAuthError: auth.AuthRequired,
  getGoogleDriveAccountId: () => auth.accountId,
  isGoogleDriveAuthError: (error: unknown) =>
    error instanceof auth.AuthRequired,
  subscribeGoogleDriveAuth: () => () => {},
  isGoogleDriveConnected: () => auth.connected,
  settleGoogleDriveSession: async () => {},
}))

vi.mock('./drive/api', async (importOriginal) => ({
  ...(await importOriginal<typeof DriveApi>()),
  isPublicDriveFile: (id: string) => publicFiles.has(id),
  rememberPublicDriveFile: (id: string) => {
    publicFiles.add(id)
  },
  registerPublicDriveFile: vi.fn(async () => {}),
  getFileMetadata: vi.fn(),
  getDriveResourceKey: () => undefined,
  rememberDriveResourceKey: vi.fn(),
  listConceptFiles: vi.fn(),
  readConceptFile: vi.fn(),
  trashConceptFile: vi.fn(),
  updateConceptFile: vi.fn(),
}))

function legacyBytes(name: string, doc: Doc) {
  return new Uint8Array(new TextEncoder().encode(serializeConcept(name, doc)))
}

let info: DocumentInfo
let remote: Doc
let docs: Array<Doc>
let sessions: Array<DocumentPersistence>

beforeEach(() => {
  auth.accountId = undefined
  auth.connected = true
  publicFiles.clear()
  vi.clearAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
  docs = []
  sessions = []
  const fileId = crypto.randomUUID()
  info = {
    id: `G${fileId}`,
    name: 'Drive document',
    updatedAt: 1,
    drive: { fileId, offlineAvailable: false },
  }
  remote = new Doc()
  docs.push(remote)
  initializeDocument(remote)
  remote.getMap('metadata').set('name', info.name)
  const version = {
    etag: '"remote-version"',
    file: {
      id: fileId,
      name: `${info.name}.concept`,
      capabilities: {
        canDownload: true,
        canEdit: true,
        canModifyContent: true,
      },
      mimeType: 'application/vnd.concept+json',
      modifiedTime: '2026-11-03T12:00:00.000Z',
      version: '3',
    },
  }
  vi.mocked(getFileMetadata).mockResolvedValue(version)
  vi.mocked(readConceptFile).mockImplementation(async () => ({
    ...version,
    content: legacyBytes(info.name, remote),
  }))
  vi.mocked(listConceptFiles).mockResolvedValue([version.file])
  vi.mocked(updateConceptFile).mockResolvedValue({
    ...version,
    etag: '"saved-version"',
  })
  vi.mocked(trashConceptFile).mockResolvedValue(undefined)
})

it('opens a fresh authorized account cache while retaining prior account work privately', async () => {
  await localDocumentStorage.put({
    ...info,
    drive: { ...info.drive!, accountId: 'previous', dirty: true },
  })
  const previous = new Doc()
  const previousSession = localDocumentStorage.open(info.id, previous)
  await previousSession.whenSynced
  previous.getText('private').insert(0, 'previous account draft')
  await previousSession.flush?.()
  await previousSession.destroy()
  previous.destroy()
  auth.accountId = 'current'
  const current = await documentStorage.get(info.id)
  expect(current?.drive?.accountId).toBe('current')
  expect(current?.drive?.dirty).toBeUndefined()
  expect((await documentStorage.list()).map((document) => document.id)).toEqual(
    [info.id],
  )
  const archive = (await localDocumentStorage.list()).find(
    (document) => document.drive?.recoveryOnly,
  )
  expect(archive?.drive?.accountId).toBe('previous')
  await expect(documentStorage.get(archive!.id)).rejects.toThrow(
    'different Google account',
  )
  auth.accountId = 'previous'
  const visible = await documentStorage.get(archive!.id)
  expect(visible?.drive?.recoveryOnly).toBe(true)
  const recovered = await recoverDocumentLocally(archive!.id)
  const restored = new Doc()
  const restoredSession = localDocumentStorage.open(recovered.id, restored)
  await restoredSession.whenSynced
  expect(restored.getText('private').toString()).toBe('previous account draft')
  await restoredSession.destroy()
  restored.destroy()
  expect((await localDocumentStorage.get(info.id))?.drive?.accountId).toBe(
    'current',
  )
})

afterEach(async () => {
  for (const session of sessions.reverse()) await session.destroy()
  for (const doc of docs) doc.destroy()
  expect(documentSessions.has(info.id)).toBe(false)
  vi.unstubAllGlobals()
})

function open(doc = new Doc()) {
  docs.push(doc)
  const session = documentStorage.open(info.id, doc)
  sessions.push(session)
  return { doc, session }
}

async function cache(drive = info.drive!) {
  await localDocumentStorage.put({
    ...info,
    drive: {
      ...drive,
      savedRevision:
        drive.savedRevision ??
        (await snapshotRevision(await captureSnapshot(info.name, remote))),
    },
  })
  const cached = new Doc()
  docs.push(cached)
  const persistence = localDocumentStorage.open(info.id, cached)
  try {
    await persistence.whenSynced
    applyUpdate(cached, encodeStateAsUpdate(remote))
    await persistence.flush?.()
  } finally {
    await persistence.destroy()
  }
}

it('registers a directly opened Drive identity without generating a local ID', async () => {
  const registered = await documentStorage.get(info.id)
  expect(getFileMetadata).toHaveBeenCalledWith(info.drive!.fileId)
  expect(registered).toMatchObject({
    id: info.id,
    name: info.name,
    drive: { fileId: info.drive!.fileId, offlineAvailable: false },
  })
  expect(await localDocumentStorage.get(info.id)).toEqual(registered)
  expect(await localDocumentStorage.list()).toHaveLength(1)
  expect(readConceptFile).not.toHaveBeenCalled()
})

it('opens the remote Yjs content before initialization can add another paragraph', async () => {
  const { doc, session } = open()
  await session.whenSynced
  expect(doc.get('root', XmlText).length).toBe(1)
  initializeDocument(doc)
  expect(doc.get('root', XmlText).length).toBe(1)
  expect(encodeStateAsUpdate(doc)).toEqual(encodeStateAsUpdate(remote))
  expect(documentSessions.get(info.id)?.doc).toBe(doc)
  expect(getSaveStatus(info.id).phase).toBe('synced')
})

it('merges active renames into Yjs and persists dirty metadata without waiting for upload', async () => {
  const { doc, session } = open()
  await session.whenSynced
  await documentStorage.rename(info.id, '  Renamed in browser  ')
  expect(doc.getMap('metadata').get('name')).toBe('Renamed in browser')
  await vi.waitFor(async () => {
    expect(await localDocumentStorage.get(info.id)).toMatchObject({
      name: 'Renamed in browser',
      drive: { dirty: true },
    })
  })
  expect(updateConceptFile).not.toHaveBeenCalled()
  expect(getSaveStatus(info.id).phase).toBe('pending')
})

it('allows explicitly offline-available cached content to open after authentication expires', async () => {
  await cache({ ...info.drive!, offlineAvailable: true })
  vi.mocked(readConceptFile).mockRejectedValue(
    new auth.AuthRequired('Reconnect'),
  )
  const { doc, session } = open()
  await session.whenSynced
  expect(encodeStateAsUpdate(doc)).toEqual(encodeStateAsUpdate(remote))
  expect(documentSessions.has(info.id)).toBe(true)
  expect(getSaveStatus(info.id).phase).toBe('auth-required')
})

it('rejects opening clean cached content without a connection when offline availability is off', async () => {
  await cache()
  vi.mocked(readConceptFile).mockRejectedValue(
    new auth.AuthRequired('Reconnect'),
  )
  const { session } = open()
  await expect(session.whenSynced).rejects.toThrow('Reconnect')
  expect(documentSessions.has(info.id)).toBe(false)
  expect(getSaveStatus(info.id).phase).toBe('auth-required')
})

it.each([false, true])(
  'rejects an observed empty Yjs root without cached content (offline availability: %s)',
  async (offlineAvailable) => {
    await localDocumentStorage.put({
      ...info,
      drive: { ...info.drive!, offlineAvailable },
    })
    const observed = new Doc()
    const root = observed.get('root', XmlText)
    expect(encodeStateAsUpdate(observed).byteLength).toBe(2)
    vi.mocked(readConceptFile).mockRejectedValue(
      new auth.AuthRequired('Reconnect'),
    )
    const { session } = open(observed)
    await expect(session.whenSynced).rejects.toThrow('Reconnect')
    expect(root.length).toBe(0)
    expect(encodeStateAsUpdate(observed).byteLength).toBe(2)
    expect((await localDocumentStorage.get(info.id))?.drive?.dirty).not.toBe(
      true,
    )
    expect(documentSessions.has(info.id)).toBe(false)
  },
)

it('retains unsynced cached edits even when offline availability is off', async () => {
  remote.getMap('settings').set('unsynced-local-edit', 'keep me')
  await cache({ ...info.drive!, dirty: true })
  vi.mocked(readConceptFile).mockRejectedValue(
    new auth.AuthRequired('Reconnect'),
  )
  const { doc, session } = open()
  await session.whenSynced
  expect(doc.getMap('settings').get('unsynced-local-edit')).toBe('keep me')
  await session.destroy()
  sessions = sessions.filter((current) => current !== session)
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { dirty: true, offlineAvailable: false },
  })
  const restored = new Doc()
  docs.push(restored)
  const persistence = localDocumentStorage.open(info.id, restored)
  try {
    await persistence.whenSynced
    expect(restored.getMap('settings').get('unsynced-local-edit')).toBe(
      'keep me',
    )
  } finally {
    await persistence.destroy()
  }
})

it('recovers cached changes that persisted before the dirty metadata flag', async () => {
  const savedRevision = await snapshotRevision(
    await captureSnapshot(info.name, remote),
  )
  remote.getMap('settings').set('unmarked-local-edit', 'recover me')
  await cache({ ...info.drive!, dirty: false, savedRevision })
  vi.mocked(readConceptFile).mockRejectedValue(
    new auth.AuthRequired('Reconnect'),
  )
  const { doc, session } = open()
  await session.whenSynced
  expect(doc.getMap('settings').get('unmarked-local-edit')).toBe('recover me')
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { dirty: true, offlineAvailable: false, savedRevision },
  })
})

function allowEvictionLock() {
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: vi.fn(
        async (
          _name: string,
          _options: unknown,
          task: (lock: object) => Promise<void>,
        ) => task({}),
      ),
    },
  })
}

it('evicts clean non-offline content only when it matches the acknowledged checkpoint', async () => {
  await cache()
  allowEvictionLock()
  await localDocumentStorage.clearContent(info.id)
  expect(
    (await indexedDB.databases()).map((database) => database.name),
  ).not.toContain(`concept-document:${info.id}`)
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    id: info.id,
    drive: { offlineAvailable: false },
  })
})

it('preserves and marks recoverable content when eviction finds an unacknowledged checkpoint', async () => {
  const savedRevision = await snapshotRevision(
    await captureSnapshot(info.name, remote),
  )
  remote.getMap('settings').set('unmarked-local-edit', true)
  await cache({ ...info.drive!, dirty: false, savedRevision })
  allowEvictionLock()
  await localDocumentStorage.clearContent(info.id)
  expect(
    (await indexedDB.databases()).map((database) => database.name),
  ).toContain(`concept-document:${info.id}`)
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { dirty: true, offlineAvailable: false, savedRevision },
  })
})

it('refreshes Drive metadata without replacing a locally pending rename', async () => {
  await localDocumentStorage.put({
    ...info,
    name: 'Pending rename',
    drive: { ...info.drive!, dirty: true, offlineAvailable: true },
  })
  await refreshDriveDocuments()
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    name: 'Pending rename',
    updatedAt: info.updatedAt,
    drive: { dirty: true, offlineAvailable: true },
  })
  expect(await localDocumentStorage.list()).toHaveLength(1)
})

it('trashes a Drive document before removing its local registration', async () => {
  await localDocumentStorage.put(info)
  await documentStorage.delete(info.id)
  expect(trashConceptFile).toHaveBeenCalledWith(info.drive!.fileId)
  expect(await localDocumentStorage.get(info.id)).toBeUndefined()
})

it('cancels an in-flight startup download when the document closes', async () => {
  let entered!: (signal: AbortSignal) => void
  const downloadStarted = new Promise<AbortSignal>((resolve) => {
    entered = resolve
  })
  vi.mocked(readConceptFile).mockImplementationOnce((_id, signal) => {
    if (!signal) throw new Error('Missing download cancellation signal')
    entered(signal)
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
    })
  })
  const { session } = open()
  const startup = session.whenSynced.then(
    () => 'resolved',
    () => 'rejected',
  )
  const signal = await downloadStarted
  expect(signal.aborted).toBe(false)
  await session.destroy()
  expect(signal.aborted).toBe(true)
  await expect(startup).resolves.toBe('rejected')
  expect(documentSessions.has(info.id)).toBe(false)
  expect(updateConceptFile).not.toHaveBeenCalled()
})

it('marks directly opened view-only Drive files as readOnly and preserves it in storage', async () => {
  vi.mocked(getFileMetadata).mockResolvedValueOnce({
    etag: '"ro-version"',
    file: {
      id: info.drive!.fileId,
      name: `${info.name}.concept`,
      mimeType: 'application/vnd.concept+json',
      modifiedTime: '2026-11-03T12:00:00.000Z',
      version: '4',
      capabilities: {
        canDownload: true,
        canEdit: false,
        canModifyContent: false,
      },
    },
  })
  const registered = await documentStorage.get(info.id)
  expect(registered).toMatchObject({
    id: info.id,
    readOnly: true,
    drive: { fileId: info.drive!.fileId, readOnly: true },
  })
})

it('rejects renaming read-only documents and preserves existing name', async () => {
  await localDocumentStorage.put({
    ...info,
    readOnly: true,
    drive: { ...info.drive!, readOnly: true },
  })
  await expect(documentStorage.rename(info.id, 'New Name')).rejects.toThrow(
    'This document is view-only and cannot be renamed.',
  )
  expect(updateConceptFile).not.toHaveBeenCalled()
  const stored = await localDocumentStorage.get(info.id)
  expect(stored?.name).toBe(info.name)
})

it('deletes local registration without trashing remote file when document is read-only', async () => {
  await localDocumentStorage.put({
    ...info,
    readOnly: true,
    drive: { ...info.drive!, readOnly: true },
  })
  await documentStorage.delete(info.id)
  expect(trashConceptFile).not.toHaveBeenCalled()
  expect(await localDocumentStorage.get(info.id)).toBeUndefined()
})

it('does not mark read-only documents dirty when clearing content for offline eviction', async () => {
  await localDocumentStorage.put({
    ...info,
    readOnly: true,
    drive: { ...info.drive!, readOnly: true, offlineAvailable: false },
  })
  await localDocumentStorage.clearContent(info.id)
  const stored = await localDocumentStorage.get(info.id)
  expect(stored?.drive?.dirty).toBeFalsy()
})

it('preserves divergent read-only content instead of evicting unsynced edits', async () => {
  const savedRevision = await snapshotRevision(
    await captureSnapshot(info.name, remote),
  )
  remote.getMap('settings').set('unsynced-edit', 'recover me')
  await cache({ ...info.drive!, readOnly: true, dirty: false, savedRevision })
  allowEvictionLock()

  await localDocumentStorage.clearContent(info.id)

  expect(
    (await indexedDB.databases()).map((database) => database.name),
  ).toContain(`concept-document:${info.id}`)
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { readOnly: true, dirty: true, savedRevision },
  })
})

it('rejects a rename when opening the cached document reveals read-only access', async () => {
  await cache()
  vi.mocked(readConceptFile).mockResolvedValueOnce({
    etag: '"view-only"',
    file: {
      id: info.drive!.fileId,
      name: `${info.name}.concept`,
      mimeType: 'application/vnd.concept+json',
      capabilities: { canDownload: true, canEdit: false },
    },
    content: legacyBytes(info.name, remote),
  })

  await expect(
    documentStorage.rename(info.id, 'Unauthorized rename'),
  ).rejects.toThrow('This document is view-only and cannot be renamed.')

  expect(updateConceptFile).not.toHaveBeenCalled()
  expect((await localDocumentStorage.get(info.id))?.name).toBe(info.name)
})

it('keeps a reopen queued behind cache eviction alive', async () => {
  await cache()
  let releaseEviction: () => void = () => {}
  const evictionLock = new Promise<void>((resolve) => {
    releaseEviction = resolve
  })
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: async (
        _name: string,
        optionsOrTask: { mode?: string } | (() => Promise<unknown>),
        task?: (lock: object) => Promise<unknown>,
      ) => {
        if (typeof optionsOrTask === 'function') return optionsOrTask()
        if (optionsOrTask.mode === 'shared') {
          await evictionLock
          return task!({})
        }
        try {
          return await task!({})
        } finally {
          releaseEviction()
        }
      },
    },
  })
  let reopening: ReturnType<typeof open> | undefined
  const get = localDocumentStorage.get.bind(localDocumentStorage)
  vi.spyOn(localDocumentStorage, 'get').mockImplementationOnce(async (id) => {
    const stored = await get(id)
    reopening = open()
    void reopening.session.whenSynced.catch(() => {})
    return stored
  })
  await localDocumentStorage.clearContent(info.id)
  expect(reopening).toBeDefined()
  await reopening!.session.whenSynced
  expect(encodeStateAsUpdate(reopening!.doc)).toEqual(
    encodeStateAsUpdate(remote),
  )
  expect(getFileMetadata).not.toHaveBeenCalled()
})

it('downloads and preserves an unopened Drive document for offline use', async () => {
  await setDocumentOfflineAvailable(info.id, true)
  expect(readConceptFile).toHaveBeenCalled()
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { offlineAvailable: true },
  })
  expect(documentSessions.has(info.id)).toBe(false)
  const cached = new Doc()
  docs.push(cached)
  const persistence = localDocumentStorage.open(info.id, cached)
  try {
    await persistence.whenSynced
    expect(cached.share.has('root')).toBe(true)
  } finally {
    await persistence.destroy()
  }
})

it('updates the active session without opening another document', async () => {
  const { session } = open()
  await session.whenSynced
  const active = documentSessions.get(info.id)!
  const change = vi.spyOn(active, 'setOfflineAvailable')
  await setDocumentOfflineAvailable(info.id, true)
  expect(change).toHaveBeenCalledWith(true)
  expect(documentSessions.get(info.id)).toBe(active)
})

it('disables offline availability without downloading an unopened document', async () => {
  await cache({ ...info.drive!, offlineAvailable: true })
  await setDocumentOfflineAvailable(info.id, false)
  expect(readConceptFile).not.toHaveBeenCalled()
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { offlineAvailable: false },
  })
})

it('keeps the editor session and status when offline preparation overlaps opening', async () => {
  const download = vi.mocked(readConceptFile).getMockImplementation()!
  let release!: () => void
  let started!: () => void
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(readConceptFile).mockImplementationOnce(async (...args) => {
    started()
    await held
    return download(...args)
  })
  const pinning = setDocumentOfflineAvailable(info.id, true)
  await began
  const { session } = open()
  await session.whenSynced
  const active = documentSessions.get(info.id)!
  const phase = getSaveStatus(info.id).phase
  release()
  await pinning
  expect(documentSessions.get(info.id)).toBe(active)
  expect(getSaveStatus(info.id).phase).toBe(phase)
  expect(await localDocumentStorage.get(info.id)).toMatchObject({
    drive: { offlineAvailable: true },
  })
})

it('denies opening cached shared content belonging to another account', async () => {
  await localDocumentStorage.put({
    id: 'Gforeign',
    name: 'Private',
    updatedAt: 0,
    drive: {
      fileId: 'foreign',
      accountId: 'other-account',
      offlineAvailable: true,
    },
  })
  vi.mocked(readConceptFile).mockRejectedValueOnce(
    new Error('Private file unavailable'),
  )
  await expect(documentStorage.get('Gforeign')).rejects.toThrow(
    'Private file unavailable',
  )
  expect(await documentStorage.list()).toEqual([])
  await expect(recoverDocumentLocally('Gforeign')).rejects.toThrow(
    'different Google account',
  )
})

it('recovers quarantined changes into a detached local document before resetting shared content', async () => {
  remote.getMap('settings').set('unsynced', 'retained work')
  await cache({ ...info.drive!, dirty: true, quarantined: true })
  const recovered = await recoverDocumentLocally(info.id)
  expect(recovered.drive).toBeUndefined()
  expect(recovered.name).toBe(`${info.name} (recovered)`)
  const copy = new Doc()
  docs.push(copy)
  const session = localDocumentStorage.open(recovered.id, copy)
  sessions.push(session)
  await session.whenSynced
  expect(copy.getMap('settings').get('unsynced')).toBe('retained work')
  expect((await localDocumentStorage.get(info.id))?.drive).toMatchObject({
    dirty: false,
    quarantined: false,
    offlineAvailable: false,
  })
  expect(updateConceptFile).not.toHaveBeenCalled()
})

it('opens and saves a public shared file anonymously and restores its offline mode', async () => {
  auth.connected = false
  publicFiles.add(info.drive!.fileId)
  const opened = await documentStorage.get(info.id)
  expect(opened?.drive).toMatchObject({
    publicAccess: true,
    accountId: undefined,
  })
  const { doc, session } = open()
  await session.whenSynced
  doc.getMap('settings').set('anonymous', true)
  await documentSessions.get(info.id)?.sync()
  expect(updateConceptFile).toHaveBeenCalledOnce()
  expect(registerPublicDriveFile).not.toHaveBeenCalled()
  await setDocumentOfflineAvailable(info.id, true)
  await session.destroy()
  publicFiles.clear()
  vi.mocked(readConceptFile).mockRejectedValue(new TypeError('Offline'))
  const reopened = open()
  await reopened.session.whenSynced
  expect(publicFiles.has(info.drive!.fileId)).toBe(true)
  expect(reopened.doc.getMap('settings').get('anonymous')).toBe(true)
  expect(getSaveStatus(info.id).phase).not.toBe('auth-required')
})

it('isolates the signed-in account cache before an anonymous public open', async () => {
  remote.getText('private').insert(0, 'prior account work')
  await cache({ ...info.drive!, accountId: 'previous-account', dirty: true })
  const published = new Doc()
  docs.push(published)
  initializeDocument(published)
  published.getMap('metadata').set('name', 'Public document')
  remote = published
  auth.connected = false
  publicFiles.add(info.drive!.fileId)
  const opened = await documentStorage.get(info.id)
  expect(opened?.drive).toMatchObject({
    publicAccess: true,
    accountId: undefined,
  })
  const current = open()
  await current.session.whenSynced
  expect(current.doc.getText('private').toString()).toBe('')
  const archived = (await localDocumentStorage.list()).find(
    (item) => item.drive?.recoveryOnly,
  )
  expect(archived?.drive?.accountId).toBe('previous-account')
  expect(await documentStorage.list()).not.toContainEqual(archived)
})

it('keeps unclaimed legacy edits in recovery instead of merging them into a public document', async () => {
  remote.getText('private').insert(0, 'unclaimed legacy draft')
  await cache({ ...info.drive!, dirty: true })
  const published = new Doc()
  docs.push(published)
  initializeDocument(published)
  published.getMap('metadata').set('name', 'Public document')
  remote = published
  auth.connected = false
  const opened = await documentStorage.get(info.id)
  expect(opened?.drive?.publicAccess).toBe(true)
  const current = open()
  await current.session.whenSynced
  expect(current.doc.getText('private').toString()).toBe('')
  const archived = (await localDocumentStorage.list()).find(
    (item) => item.drive?.recoveryOnly,
  )
  expect(archived?.drive?.quarantined).toBe(true)
  expect(archived?.drive?.dirty).toBe(true)
})

it('removes an anonymous public document locally without trying to trash its publisher file', async () => {
  auth.connected = false
  await localDocumentStorage.put({
    ...info,
    drive: { ...info.drive!, publicAccess: true },
  })
  await documentStorage.delete(info.id)
  expect(trashConceptFile).not.toHaveBeenCalled()
  expect(await localDocumentStorage.get(info.id)).toBeUndefined()
})

it('preserves a named private offline cache when its app session expires', async () => {
  auth.accountId = 'previous-account'
  auth.connected = false
  remote.getText('private').insert(0, 'available offline')
  await cache({
    ...info.drive!,
    accountId: auth.accountId,
    offlineAvailable: true,
  })
  const opened = open()
  await opened.session.whenSynced
  expect(opened.doc.getText('private').toString()).toBe('available offline')
  expect(getSaveStatus(info.id).access).toMatchObject({
    kind: 'unverified',
    reason: 'authentication',
  })
  expect(getSaveStatus(info.id).phase).toBe('auth-required')
  expect(readConceptFile).not.toHaveBeenCalled()
  expect(publicFiles.size).toBe(0)
})
