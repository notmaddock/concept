import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { Doc } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localDocumentStorage } from './storage'
import type { DocumentPersistence } from './storage'

let sessions: Array<DocumentPersistence>
let docs: Array<Doc>

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  sessions = []
  docs = []
})

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.destroy()))
  docs.forEach((doc) => doc.destroy())
  vi.unstubAllGlobals()
})

async function open(id: string) {
  const doc = new Doc()
  docs.push(doc)
  const session = localDocumentStorage.open(id, doc)
  sessions.push(session)
  await session.whenSynced
  return { doc, session }
}

async function databaseNames() {
  return (await indexedDB.databases()).map((database) => database.name)
}

async function storedRecord(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('concept-documents', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('documents', 'readonly')
      const record = transaction.objectStore('documents').get(id)
      transaction.oncomplete = () => {
        db.close()
        resolve(record.result)
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}

it('drops the content database after closing all active sessions for a document', async () => {
  const document = await localDocumentStorage.create()
  const first = await open(document.id)
  await open(document.id)
  first.doc.getText('test').insert(0, 'Saved content')
  expect(await databaseNames()).toContain(`concept-document:${document.id}`)

  await localDocumentStorage.delete(document.id)

  expect(await databaseNames()).not.toContain(`concept-document:${document.id}`)
  expect(await localDocumentStorage.get(document.id)).toBeUndefined()
  expect(await storedRecord(document.id)).toBeUndefined()
  expect(await localDocumentStorage.list()).toEqual([])
  first.doc.getText('test').insert(0, 'No longer persisted')
  expect(await databaseNames()).not.toContain(`concept-document:${document.id}`)
})

it('drops a closed document database without affecting another document', async () => {
  const removed = await localDocumentStorage.create()
  const retained = await localDocumentStorage.create()
  const { session } = await open(removed.id)
  await session.destroy()
  await open(retained.id)

  await localDocumentStorage.delete(removed.id)

  expect(await databaseNames()).not.toContain(`concept-document:${removed.id}`)
  expect(await databaseNames()).toContain(`concept-document:${retained.id}`)
  expect(await localDocumentStorage.get(retained.id)).toEqual(retained)
})

it('keeps metadata available for retry if dropping the database fails', async () => {
  const document = await localDocumentStorage.create()
  const deletion = vi
    .spyOn(indexedDB, 'deleteDatabase')
    .mockImplementationOnce(() => {
      throw new Error('Storage unavailable')
    })
  await expect(localDocumentStorage.delete(document.id)).rejects.toThrow(
    'Storage unavailable',
  )
  expect(await storedRecord(document.id)).toEqual(document)
  deletion.mockRestore()
  await localDocumentStorage.delete(document.id)
  expect(await storedRecord(document.id)).toBeUndefined()
})

it('does not recreate metadata when a rename arrives after a deletion', async () => {
  const document = await localDocumentStorage.create()
  await localDocumentStorage.delete(document.id)
  await expect(
    localDocumentStorage.rename(document.id, 'Stale rename'),
  ).rejects.toThrow('Document not found')
  expect(await storedRecord(document.id)).toBeUndefined()
})

it('drops a database held by a separate tab storage instance', async () => {
  const document = await localDocumentStorage.create()
  vi.resetModules()
  const { localDocumentStorage: otherTab } = await import('./storages/local')
  const doc = new Doc()
  docs.push(doc)
  const remoteSession = otherTab.open(document.id, doc)
  sessions.push(remoteSession)
  await remoteSession.whenSynced
  await localDocumentStorage.delete(document.id)
  expect(await databaseNames()).not.toContain(`concept-document:${document.id}`)
  doc.getText('content').insert(0, 'Should not recreate storage')
  expect(await databaseNames()).not.toContain(`concept-document:${document.id}`)
})

it('does not recreate a deleted database from a stale open request', async () => {
  const document = await localDocumentStorage.create()
  const deletion = localDocumentStorage.delete(document.id)
  const doc = new Doc()
  docs.push(doc)
  const staleSession = localDocumentStorage.open(document.id, doc)
  sessions.push(staleSession)
  const rejected = expect(staleSession.whenSynced).rejects.toThrow(
    /Document (not found|closed)/,
  )
  await deletion
  await rejected
  expect(await databaseNames()).not.toContain(`concept-document:${document.id}`)
})

it('reuses its metadata connection and releases it for database upgrades', async () => {
  const openDatabase = vi.spyOn(indexedDB, 'open')
  const document = await localDocumentStorage.create()
  await localDocumentStorage.list()
  await localDocumentStorage.rename(document.id, 'Renamed')
  await localDocumentStorage.get(document.id)
  expect(openDatabase).toHaveBeenCalledTimes(1)
  await new Promise<void>((resolve, reject) => {
    const upgrade = indexedDB.open('concept-documents', 2)
    upgrade.onsuccess = () => {
      upgrade.result.close()
      resolve()
    }
    upgrade.onerror = () => reject(upgrade.error)
    upgrade.onblocked = () =>
      reject(new Error('Metadata connection blocked upgrade'))
  })
  openDatabase.mockRestore()
})

it('repairs an aborted update before reporting a successful local flush', async () => {
  const document = await localDocumentStorage.create()
  const { doc, session } = await open(document.id)
  await session.flush?.()
  const originalAdd = IDBObjectStore.prototype.add
  const failures: Array<unknown> = []
  let aborted = false
  const abortUpdate = vi
    .spyOn(IDBObjectStore.prototype, 'add')
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalAdd>
    ) {
      const request = originalAdd.call(this, ...args)
      if (this.name === 'updates' && !aborted) {
        aborted = true
        request.addEventListener('error', (event) => {
          failures.push(request.error)
          // The upstream write promise is ignored; suppress only its injected rejection.
          request.onerror = null
          event.preventDefault()
        })
        this.transaction.abort()
      }
      return request
    })
  try {
    doc.getText('content').insert(0, 'Survives the aborted transaction')
    expect(aborted).toBe(true)
    await session.flush?.()
    expect(failures).toHaveLength(1)
    await session.destroy()
    const restored = await open(document.id)
    expect(restored.doc.getText('content').toString()).toBe(
      'Survives the aborted transaction',
    )
  } finally {
    abortUpdate.mockRestore()
  }
})

it('preserves a rename made while a local document is closed when it is reopened', async () => {
  const { documentStorage } = await import('./document-storage')
  const { documentName } = await import('./sync')
  const created = await documentStorage.create()
  const firstDoc = new Doc()
  docs.push(firstDoc)
  const firstSession = documentStorage.open(created.id, firstDoc)
  sessions.push(firstSession)
  await firstSession.whenSynced
  await documentStorage.rename(created.id, 'First active name')
  expect(firstDoc.getMap('metadata').get('name')).toBe('First active name')
  await firstSession.destroy()

  const renamedClosed = await documentStorage.rename(
    created.id,
    'Renamed while closed',
  )
  expect(renamedClosed.name).toBe('Renamed while closed')

  const secondDoc = new Doc()
  docs.push(secondDoc)
  const secondSession = documentStorage.open(created.id, secondDoc)
  sessions.push(secondSession)
  await secondSession.whenSynced
  expect(secondDoc.getMap('metadata').get('name')).toBe('Renamed while closed')
  expect(documentName(secondDoc, renamedClosed.name)).toBe(
    'Renamed while closed',
  )
  const { getSaveStatus } = await import('./sync')
  await vi.waitFor(() => {
    expect(getSaveStatus(created.id).phase).toBe('local')
  })
  await secondSession.destroy()
  expect(getSaveStatus(created.id)).toEqual({ phase: 'loading' })
})

it('batches metadata persistence during rapid Drive edits and reports sync failures via toast', async () => {
  const driveAuth = await import('./drive/auth')
  const connected = vi
    .spyOn(driveAuth, 'isGoogleDriveConnected')
    .mockReturnValue(true)
  const { toast } = await import('sonner')
  const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const api = await import('./drive/api')
  const updateSpy = vi
    .spyOn(api, 'updateConceptFile')
    .mockRejectedValueOnce(new api.DriveError(500, 'Drive unavailable'))
  const { initializeDocument } = await import('./initial-document')
  const { serializeConcept } = await import('./serialization')
  const remoteDoc = new Doc()
  docs.push(remoteDoc)
  initializeDocument(remoteDoc)
  remoteDoc.getMap('metadata').set('name', 'Doc')
  const readSpy = vi.spyOn(api, 'readConceptFile').mockResolvedValueOnce({
    etag: '"v1"',
    file: {
      id: 'drive-id',
      capabilities: {
        canDownload: true,
        canEdit: true,
        canModifyContent: true,
      },
      name: 'Doc.concept',
      mimeType: 'application/vnd.concept+json',
    },
    content: new Uint8Array(
      new TextEncoder().encode(serializeConcept('Doc', remoteDoc)),
    ),
  })
  const metadataSpy = vi.spyOn(api, 'getFileMetadata').mockResolvedValue({
    etag: '"v1"',
    file: {
      id: 'drive-id',
      name: 'Doc.concept',
      mimeType: 'application/vnd.concept+json',
      capabilities: {
        canDownload: true,
        canEdit: true,
        canModifyContent: true,
      },
    },
  })
  const { localDocumentStorage: activeLocalStorage } = await import('./storage')
  const patchSpy = vi.spyOn(activeLocalStorage, 'patch')
  const { DocumentSync } = await import('./sync')

  const info = {
    id: 'Gdrive-id',
    name: 'Doc',
    updatedAt: 1,
    drive: { fileId: 'drive-id', offlineAvailable: true },
  }
  await activeLocalStorage.put(info)
  const doc = new Doc()
  docs.push(doc)
  const sync = new DocumentSync(info, doc, {
    whenSynced: Promise.resolve(),
    flush: async () => {},
    destroy: async () => {},
  })
  try {
    await sync.start()
    patchSpy.mockClear()
    doc.getMap('settings').set('a', 1)
    doc.getMap('settings').set('b', 2)
    doc.getMap('settings').set('c', 3)
    await vi.waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1)
    })

    await sync.sync()
    expect(toastSpy).toHaveBeenCalledWith('Drive unavailable', {
      id: 'drive-sync:Gdrive-id',
    })
  } finally {
    await sync.stop()
    toastSpy.mockRestore()
    updateSpy.mockRestore()
    connected.mockRestore()
    metadataSpy.mockRestore()
    readSpy.mockRestore()
    patchSpy.mockRestore()
  }
})

it('archives prior account work before replacing a canonical Drive cache', async () => {
  const id = 'Gshared-account-file'
  await localDocumentStorage.put({
    id,
    name: 'Private draft',
    updatedAt: 1,
    drive: {
      fileId: 'shared-account-file',
      accountId: 'old-account',
      offlineAvailable: true,
      dirty: true,
    },
  })
  const original = await open(id)
  original.doc.getText('private').insert(0, 'retained old account work')
  await original.session.flush?.()
  const replacement = {
    id,
    name: 'Fresh remote',
    updatedAt: 2,
    drive: {
      fileId: 'shared-account-file',
      accountId: 'new-account',
      offlineAvailable: false,
    },
  }
  await localDocumentStorage.archiveAccountCache(id, replacement)
  expect(await localDocumentStorage.get(id)).toEqual(replacement)
  const archived = (await localDocumentStorage.list()).find(
    (document) => document.drive?.recoveryOnly,
  )
  expect(archived?.drive?.accountId).toBe('old-account')
  expect(archived?.drive?.quarantined).toBe(true)
  const retained = await open(archived!.id)
  expect(retained.doc.getText('private').toString()).toBe(
    'retained old account work',
  )
  const fresh = await open(id)
  expect(fresh.doc.getText('private').toString()).toBe('')
})
