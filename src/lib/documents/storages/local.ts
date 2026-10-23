import { publishDocumentChange, subscribeToLibrary } from '../library-channel'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type { Doc } from 'yjs'
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
  let persistence: IndexeddbPersistence | undefined
  let closed = false
  let closing: Promise<void> | undefined
  const ensureOpen = () => {
    if (closed) throw new Error('Document closed')
  }
  const whenSynced = withDocumentLock(id, async () => {
    ensureOpen()
    const document = await query<DocumentInfo | undefined>(
      'readonly',
      (store) => store.get(id),
    )
    if (!document) throw new Error('Document not found')
    ensureOpen()
    const { IndexeddbPersistence } = await import('y-indexeddb')
    ensureOpen()
    persistence = new IndexeddbPersistence(documentDatabaseName(id), doc)
    await persistence.whenSynced
    if (persistence.db)
      persistence.db.onversionchange = () => {
        void session.destroy()
      }
  })
  const session: DocumentPersistence = {
    whenSynced,
    destroy() {
      closed = true
      closing ??= (
        persistence
          ? whenSynced.catch(() => {}).then(() => persistence?.destroy())
          : Promise.resolve()
      )
        .then(() => {})
        .finally(() => {
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

export const localDocumentStorage: DocumentStorage = {
  subscribe: subscribeToLibrary,
  async list() {
    const documents = await query<Array<DocumentInfo>>('readonly', (store) =>
      store.getAll(),
    )
    return documents.sort((a, b) => b.updatedAt - a.updatedAt)
  },
  get: (id) =>
    query<DocumentInfo | undefined>('readonly', (store) => store.get(id)),
  async create() {
    const document = {
      id: crypto.randomUUID(),
      name: 'Untitled document',
      updatedAt: Date.now(),
    }
    await query('readwrite', (store) => store.add(document))
    publishDocumentChange({ type: 'upsert', document })
    return document
  },
  async rename(id, name) {
    const db = await database()
    const document = await new Promise<DocumentInfo>((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite')
      const store = transaction.objectStore('documents')
      const request: IDBRequest<DocumentInfo | undefined> = store.get(id)
      let updated: DocumentInfo | undefined
      request.onsuccess = () => {
        if (!request.result) {
          transaction.abort()
          return
        }
        updated = {
          ...request.result,
          name: name.trim() || 'Untitled document',
          updatedAt: Date.now(),
        }
        store.put(updated)
      }
      transaction.oncomplete = () => {
        if (updated) resolve(updated)
      }
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Document not found'))
      }
      transaction.onerror = () => {
        reject(transaction.error)
      }
    })
    publishDocumentChange({ type: 'upsert', document })
    return document
  },
  async delete(id) {
    await withDocumentLock(id, async () => {
      const document = await query<DocumentInfo | undefined>(
        'readonly',
        (store) => store.get(id),
      )
      if (!document) throw new Error('Document not found')
      await removeDocumentContent(id)
      await query('readwrite', (store) => store.delete(id))
      publishDocumentChange({ type: 'delete', id })
    })
  },
  open: openDocument,
}

// Recovery metadata uses Concept identity; provider file IDs never key IndexedDB.
export async function storeDocumentInfo(document: DocumentInfo) {
  await query('readwrite', (store) => store.put(document))
  publishDocumentChange({ type: 'upsert', document })
  return document
}
