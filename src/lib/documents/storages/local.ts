import { publishDocumentChange, subscribeToLibrary } from '../library-channel'
import type { IndexeddbPersistence } from 'y-indexeddb'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { snapshotRevision } from '../package'
import { openAssetRepository, deleteDocumentAssets } from '../assets'
import {
  attachDocumentAssets,
  setDocumentRecoveryAssets,
  captureSnapshot,
} from '../working'
import type {
  DocumentInfo,
  DocumentPersistence,
  DocumentStorage,
} from '../storage'

const databases = new WeakMap<IDBFactory, Promise<IDBDatabase>>()

function database(): Promise<IDBDatabase> {
  const factory = indexedDB
  const existing = databases.get(factory)
  if (existing) return existing
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('concept-documents', 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore('documents', { keyPath: 'id' })
    request.onsuccess = () => {
      const db = request.result
      const invalidate = () => {
        if (databases.get(factory) === connection) databases.delete(factory)
      }
      db.onversionchange = () => {
        db.close()
        invalidate()
      }
      db.onclose = invalidate
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
  databases.set(factory, connection)
  void connection.catch(() => {
    if (databases.get(factory) === connection) databases.delete(factory)
  })
  return connection
}

async function query<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', mode)
    const request = action(transaction.objectStore('documents'))
    transaction.oncomplete = () => {
      resolve(request.result)
    }
    transaction.onabort = () => {
      reject(transaction.error ?? request.error)
    }
    transaction.onerror = () => {
      reject(transaction.error ?? request.error)
    }
  })
}

const activeSessions = new Map<string, Set<DocumentPersistence>>()

function documentDatabaseName(id: string) {
  return `concept-document:${id}`
}

async function removeDocumentContent(id: string) {
  await Promise.all(
    [...(activeSessions.get(id) ?? [])].map((session) => session.destroy()),
  )
  // y-indexeddb clearData() does not await the underlying database deletion.
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(documentDatabaseName(id))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(
        new Error(
          'Close other tabs using this document and try deleting again.',
        ),
      )
  })
}

const lifecycleTasks = new Map<string, Promise<unknown>>()

// Serialize opens with deletion so a stale tab cannot recreate a dropped database.
function withDocumentLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(`concept-document-lifecycle:${id}`, task)
  }
  const previous = lifecycleTasks.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  lifecycleTasks.set(id, current)
  void current
    .finally(() => {
      if (lifecycleTasks.get(id) === current) lifecycleTasks.delete(id)
    })
    .catch(() => {})
  return current
}

function openDocument(id: string, doc: Doc): DocumentPersistence {
  const sessions = activeSessions.get(id) ?? new Set<DocumentPersistence>()
  activeSessions.set(id, sessions)
  const assets = openAssetRepository(id, {
    async assertWritable() {
      if (
        !(await query<DocumentInfo | undefined>('readonly', (store) =>
          store.get(id),
        ))
      )
        throw new Error('Document not found')
    },
  })
  const detachAssets = attachDocumentAssets(doc, assets)
  let persistence: IndexeddbPersistence | undefined
  let closed = false
  let closing: Promise<void> | undefined
  let releaseContentLock: (() => void) | undefined
  let writeFailed = false
  const contentLock =
    typeof navigator !== 'undefined' && 'locks' in navigator
      ? new Promise<void>((resolve, reject) => {
          void navigator.locks
            .request(`concept-content:${id}`, { mode: 'shared' }, async () => {
              const released = new Promise<void>((release) => {
                releaseContentLock = release
              })
              resolve()
              await released
            })
            .catch(reject)
        })
      : Promise.resolve()
  const ensureOpen = () => {
    if (closed) throw new Error('Document closed')
  }
  let started = false
  const whenSynced = withDocumentLock(id, async () => {
    started = true
    ensureOpen()
    await contentLock
    ensureOpen()
    const document = await query<DocumentInfo | undefined>(
      'readonly',
      (store) => store.get(id),
    )
    if (!document) throw new Error('Document not found')
    setDocumentRecoveryAssets(doc, document.recoveryMissingAssets ?? [])
    ensureOpen()
    const { IndexeddbPersistence } = await import('y-indexeddb')
    ensureOpen()
    persistence = new IndexeddbPersistence(documentDatabaseName(id), doc)
    await persistence.whenSynced
    if (persistence.db) {
      persistence.db.addEventListener('abort', () => {
        writeFailed = true
      })
      persistence.db.onversionchange = () => {
        void session.destroy()
      }
    }
  })
  const session: DocumentPersistence = {
    whenSynced,
    async flush() {
      await whenSynced
      await assets.flush()
      const db = persistence?.db
      if (!db) throw new Error('Local storage is unavailable.')
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('updates', 'readonly')
        transaction.objectStore('updates').count()
        transaction.oncomplete = () => resolve()
        transaction.onabort = transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not save locally.'))
      })
      if (writeFailed)
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('updates', 'readwrite')
          transaction.objectStore('updates').add(encodeStateAsUpdate(doc))
          transaction.oncomplete = () => {
            writeFailed = false
            resolve()
          }
          transaction.onabort = transaction.onerror = () =>
            reject(transaction.error ?? new Error('Could not save locally.'))
        })
    },
    destroy() {
      closed = true
      detachAssets()
      assets.close()
      closing ??= (
        started
          ? whenSynced.catch(() => {}).then(() => persistence?.destroy())
          : Promise.resolve()
      )
        .then(() => {})
        .finally(() => {
          void contentLock.finally(() => releaseContentLock?.()).catch(() => {})
          detachAssets()
          assets.close()
          sessions.delete(session)
          if (sessions.size === 0 && activeSessions.get(id) === sessions)
            activeSessions.delete(id)
        })
      return closing
    },
  }
  sessions.add(session)
  return session
}

export const localDocumentStorage: DocumentStorage & {
  createStaged: () => Promise<DocumentInfo>
  put: (document: DocumentInfo) => Promise<void>
  patch: (
    id: string,
    update: (document: DocumentInfo) => DocumentInfo,
    initial?: DocumentInfo,
  ) => Promise<DocumentInfo>
  clearContent: (id: string) => Promise<void>
} = {
  async createStaged() {
    const document: DocumentInfo = {
      id: crypto.randomUUID(),
      name: 'Untitled document',
      updatedAt: Date.now(),
      importing: true,
    }
    await query('readwrite', (store) => store.add(document))
    return document
  },
  async put(document) {
    await query('readwrite', (store) => store.put(document))
    if (!document.importing) publishDocumentChange({ type: 'upsert', document })
  },
  async patch(id, update, initial) {
    const db = await database()
    const document = await new Promise<DocumentInfo>((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite')
      const store = transaction.objectStore('documents')
      const request: IDBRequest<DocumentInfo | undefined> = store.get(id)
      let updated: DocumentInfo | undefined
      request.onsuccess = () => {
        const current = request.result ?? initial
        if (!current) {
          transaction.abort()
          return
        }
        updated = update(current)
        store.put(updated)
      }
      transaction.oncomplete = () => {
        if (updated) resolve(updated)
      }
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('Document not found'))
    })
    if (!document.importing) publishDocumentChange({ type: 'upsert', document })
    return document
  },
  async clearContent(id) {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) return
    await navigator.locks.request(
      `concept-content:${id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock || activeSessions.get(id)?.size) return
        const document = await localDocumentStorage.get(id)
        if (
          document?.drive &&
          !document.drive.offlineAvailable &&
          !document.drive.dirty
        ) {
          const doc = new Doc()
          const { IndexeddbPersistence } = await import('y-indexeddb')
          const cached = new IndexeddbPersistence(documentDatabaseName(id), doc)
          const assets = openAssetRepository(id)
          const detachAssets = attachDocumentAssets(doc, assets)
          let matches = false
          try {
            await cached.whenSynced
            const name =
              doc.getMap<string>('metadata').get('name') ?? document.name
            matches =
              encodeStateAsUpdate(doc).byteLength === 2 ||
              (await snapshotRevision(await captureSnapshot(name, doc))) ===
                document.drive.savedRevision
          } finally {
            await cached.destroy()
            detachAssets()
            assets.close()
            doc.destroy()
          }
          // A new open can queue behind our exclusive content lock while the
          // checkpoint is inspected. Leave its cache and session intact.
          if (matches) {
            if (!activeSessions.get(id)?.size) await removeDocumentContent(id)
          } else
            await localDocumentStorage.patch(id, (current) => ({
              ...current,
              drive: current.drive
                ? { ...current.drive, dirty: true }
                : undefined,
            }))
        }
      },
    )
  },
  subscribe: subscribeToLibrary,
  async list() {
    const documents = await query<Array<DocumentInfo>>('readonly', (store) =>
      store.getAll(),
    )
    return documents
      .filter((document) => !document.importing)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
  get: (id) =>
    query<DocumentInfo | undefined>('readonly', (store) => store.get(id)),
  async create() {
    const document: DocumentInfo = {
      id: crypto.randomUUID(),
      name: 'Untitled document',
      updatedAt: Date.now(),
    }
    await query('readwrite', (store) => store.add(document))
    if (!document.importing) publishDocumentChange({ type: 'upsert', document })
    return document
  },
  rename(id, name) {
    return this.patch(id, (current) => ({
      ...current,
      name: name.trim() || 'Untitled document',
      updatedAt: Date.now(),
    }))
  },
  async delete(id) {
    await withDocumentLock(id, async () => {
      const document = await query<DocumentInfo | undefined>(
        'readonly',
        (store) => store.get(id),
      )
      if (!document) throw new Error('Document not found')
      await removeDocumentContent(id)
      await deleteDocumentAssets(id, { alreadyLocked: true })
      await query('readwrite', (store) => store.delete(id))
      publishDocumentChange({ type: 'delete', id })
    })
  },
  open: openDocument,
}
