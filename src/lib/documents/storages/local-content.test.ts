import 'fake-indexeddb/auto'
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'
import { IndexeddbPersistence } from 'y-indexeddb'
import type * as IndexeddbModule from 'y-indexeddb'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  openDocument,
  persistDocumentUpdate,
  publishDocumentUpdate,
  removeDocumentContent,
} from './local-content'
import { localMetadata } from './local-metadata'

let rejectSync = false
vi.mock('y-indexeddb', async (importOriginal) => {
  const actual = await importOriginal<typeof IndexeddbModule>()
  return {
    ...actual,
    IndexeddbPersistence: class extends actual.IndexeddbPersistence {
      constructor(name: string, doc: Doc) {
        super(name, doc)
        if (rejectSync)
          this.whenSynced = this.whenSynced.then(() => {
            throw new Error('Sync failed')
          })
      }
    },
  }
})

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  rejectSync = false
})
afterEach(() => vi.unstubAllGlobals())

async function connect(id: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`concept-document:${id}`)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

it('merges a peer append after initial load into the compacted snapshot', async () => {
  const { id } = await localMetadata.create()
  const imported = new Doc()
  const peer = new Doc()
  imported.getMap('content').set('imported', 'imported edit')
  peer.getMap('content').set('peer', 'peer edit')
  await persistDocumentUpdate(id, encodeStateAsUpdate(imported))
  const peerDb = await connect(id)
  const emit = IndexeddbPersistence.prototype.emit
  let appended = false
  vi.spyOn(IndexeddbPersistence.prototype, 'emit').mockImplementation(function (
    this: IndexeddbPersistence,
    event,
    args,
  ) {
    if (event === 'synced' && !appended) {
      appended = true
      // Initial fetch has applied its snapshot. Queue a different connection's
      // write before compaction starts, without broadcasting it to the importer.
      peerDb
        .transaction('updates', 'readwrite')
        .objectStore('updates')
        .add(encodeStateAsUpdate(peer))
    }
    return emit.call(this, event, args)
  })
  imported.getMap('content').set('second', 'second import')
  await persistDocumentUpdate(id, encodeStateAsUpdate(imported))
  expect(appended).toBe(true)
  const count = peerDb.transaction('updates').objectStore('updates').count()
  await new Promise<void>((resolve) => {
    count.onsuccess = () => resolve()
  })
  expect(count.result).toBe(1)
  peerDb.close()
  const reopened = new Doc()
  const session = openDocument(id, reopened)
  try {
    await session.whenSynced
    expect(reopened.getMap('content').toJSON()).toEqual({
      imported: 'imported edit',
      second: 'second import',
      peer: 'peer edit',
    })
  } finally {
    await session.destroy()
    imported.destroy()
    peer.destroy()
    reopened.destroy()
  }
})

it('propagates compaction abort and releases its temporary persistence', async () => {
  const { id } = await localMetadata.create()
  const doc = new Doc()
  doc.getText('content').insert(0, 'retained')
  await persistDocumentUpdate(id, encodeStateAsUpdate(doc))
  const transaction = IDBDatabase.prototype.transaction
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    const result = transaction.apply(this, args)
    if (args[0] === 'updates' && args[1] === 'readwrite') {
      // y-indexeddb uses an array of store names; this is our compaction.
      queueMicrotask(() => result.abort())
    }
    return result
  })
  await expect(
    persistDocumentUpdate(id, encodeStateAsUpdate(doc)),
  ).rejects.toThrow('Could not save document content')
  await expect(removeDocumentContent(id)).resolves.toBeUndefined()
  doc.destroy()
})

it('releases the lifecycle lock when closed after persistence creation but before sync', async () => {
  const { id } = await localMetadata.create()
  const doc = new Doc()
  const open = indexedDB.open.bind(indexedDB)
  let close: Promise<void> | undefined
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
    const request = open(...args)
    if (args[0] === `concept-document:${id}`)
      queueMicrotask(() => {
        close = session.destroy()
      })
    return request
  })
  const session = openDocument(id, doc)
  await expect(session.whenSynced).rejects.toThrow('Document closed')
  await close
  spy.mockRestore()
  await expect(removeDocumentContent(id)).resolves.toBeUndefined()
  const reopened = openDocument(id, doc)
  await reopened.whenSynced
  await reopened.destroy()
  doc.destroy()
})

it('unregisters failed sessions and closes their already opened database', async () => {
  const { id } = await localMetadata.create()
  const doc = new Doc()
  const peer = new Doc()
  peer.getText('content').insert(0, 'must not reach failed session')
  rejectSync = true
  const session = openDocument(id, doc)
  await expect(session.whenSynced).rejects.toThrow('Sync failed')
  publishDocumentUpdate(id, encodeStateAsUpdate(peer))
  expect(doc.getText('content').toString()).toBe('')
  await expect(removeDocumentContent(id)).resolves.toBeUndefined()
  await session.destroy()
  doc.destroy()
  peer.destroy()
})

it('destroys the temporary document and persistence when import sync rejects', async () => {
  const { id } = await localMetadata.create()
  const doc = new Doc()
  const update = encodeStateAsUpdate(doc)
  doc.destroy()
  const destroy = vi.spyOn(Doc.prototype, 'destroy')
  rejectSync = true
  await expect(persistDocumentUpdate(id, update)).rejects.toThrow('Sync failed')
  expect(destroy).toHaveBeenCalledTimes(1)
  await expect(removeDocumentContent(id)).resolves.toBeUndefined()
})

it('destroys the temporary document even when persistence cleanup rejects', async () => {
  const { id } = await localMetadata.create()
  const doc = new Doc()
  const update = encodeStateAsUpdate(doc)
  doc.destroy()
  const destroyDoc = vi.spyOn(Doc.prototype, 'destroy')
  const destroyPersistence = IndexeddbPersistence.prototype.destroy
  vi.spyOn(IndexeddbPersistence.prototype, 'destroy').mockImplementation(
    async function (this: IndexeddbPersistence) {
      await destroyPersistence.call(this)
      throw new Error('Cleanup failed')
    },
  )
  await expect(persistDocumentUpdate(id, update)).rejects.toThrow(
    'Cleanup failed',
  )
  expect(destroyDoc).toHaveBeenCalledTimes(1)
  await expect(removeDocumentContent(id)).resolves.toBeUndefined()
})
