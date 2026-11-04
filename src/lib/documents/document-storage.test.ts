import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { documentStorage, refreshDriveDocuments } from './document-storage'
import { localDocumentStorage } from './storage'
import type { DocumentInfo, DocumentPersistence } from './storage'
import { documentSessions, getSaveStatus } from './sync'
import { initializeDocument } from './initial-document'
import { serializeConcept } from './serialization'
import { documentRevision } from './revision'
import {
  getFileMetadata,
  listConceptFiles,
  readConceptFile,
  trashConceptFile,
  updateConceptFile,
} from './drive/api'

const auth = vi.hoisted(() => {
  class AuthRequired extends Error {}
  return { AuthRequired }
})

vi.mock('./drive/auth', () => ({
  isGoogleDriveAuthError: (error: unknown) =>
    error instanceof auth.AuthRequired,
  subscribeGoogleDriveAuth: () => () => {},
  isGoogleDriveConnected: () => true,
}))

vi.mock('./drive/api', () => ({
  DriveError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  },
  isDriveFileReadOnly: (file: {
    capabilities?: { canEdit?: boolean; canModifyContent?: boolean }
  }) =>
    Boolean(
      file.capabilities &&
      (file.capabilities.canEdit === false ||
        file.capabilities.canModifyContent === false),
    ),
  getFileMetadata: vi.fn(),
  listConceptFiles: vi.fn(),
  readConceptFile: vi.fn(),
  trashConceptFile: vi.fn(),
  updateConceptFile: vi.fn(),
}))

let info: DocumentInfo
let remote: Doc
let docs: Array<Doc>
let sessions: Array<DocumentPersistence>

beforeEach(() => {
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
      mimeType: 'application/vnd.concept+json',
      modifiedTime: '2026-11-03T12:00:00.000Z',
      version: '3',
    },
  }
  vi.mocked(getFileMetadata).mockResolvedValue(version)
  vi.mocked(readConceptFile).mockImplementation(async () => ({
    ...version,
    content: serializeConcept(info.name, remote),
  }))
  vi.mocked(listConceptFiles).mockResolvedValue([version.file])
  vi.mocked(updateConceptFile).mockResolvedValue({
    ...version,
    etag: '"saved-version"',
  })
  vi.mocked(trashConceptFile).mockResolvedValue(undefined)
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
        (await documentRevision(serializeConcept(info.name, remote))),
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
  const savedRevision = await documentRevision(
    serializeConcept(info.name, remote),
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
  const savedRevision = await documentRevision(
    serializeConcept(info.name, remote),
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
      capabilities: { canEdit: false, canModifyContent: false },
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
  const savedRevision = await documentRevision(
    serializeConcept(info.name, remote),
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
      capabilities: { canEdit: false },
    },
    content: serializeConcept(info.name, remote),
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
