import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Doc } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localDocumentStorage } from './storages/local'
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
