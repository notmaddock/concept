import { publishDocumentChange, subscribeToLibrary } from '../library-channel'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { IndexeddbPersistence } from 'y-indexeddb'
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
const activeDocuments = new Map<string, Map<DocumentPersistence, Doc>>()

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
          activeDocuments.get(id)?.delete(session)
          if (!activeDocuments.get(id)?.size) activeDocuments.delete(id)
          sessions.delete(session)
          if (sessions.size === 0 && activeSessions.get(id) === sessions)
            activeSessions.delete(id)
        })
      return closing
    },
  }
  sessions.add(session)
  const documents =
    activeDocuments.get(id) ?? new Map<DocumentPersistence, Doc>()
  activeDocuments.set(id, documents)
  documents.set(session, doc)
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

// Read and replace metadata in one transaction, preserving concurrent mutations.
export async function updateDocumentInfo(
  id: string,
  update: (current: DocumentInfo | undefined) => DocumentInfo | undefined,
) {
  const db = await database()
  const document = await new Promise<DocumentInfo | undefined>(
    (resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite')
      const store = transaction.objectStore('documents')
      const request: IDBRequest<DocumentInfo | undefined> = store.get(id)
      let result: DocumentInfo | undefined
      let error: unknown
      request.onsuccess = () => {
        try {
          result = update(request.result)
          if (result) store.put(result)
        } catch (cause) {
          error = cause
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () =>
        reject(
          error ??
            transaction.error ??
            new Error('Could not update document metadata.'),
        )
      transaction.onerror = () => reject(transaction.error)
    },
  )
  if (document) publishDocumentChange({ type: 'upsert', document })
  return document
}

// y-indexeddb does not observe writes from another persistence instance.
export function publishDocumentUpdate(id: string, update: Uint8Array) {
  for (const doc of new Set(activeDocuments.get(id)?.values()))
    applyUpdate(doc, update)
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`concept-document-sync:${id}`)
    channel.postMessage({ type: 'update', update })
    channel.close()
  }
}

// Imports share the lifecycle lock with opening/deleting document content.
export function persistDocumentUpdate(id: string, update: Uint8Array) {
  return withDocumentLock(id, async () => {
    if (!(await localDocumentStorage.get(id)))
      throw new Error('Document not found')
    const { IndexeddbPersistence } = await import('y-indexeddb')
    const doc = new Doc()
    const persistence = new IndexeddbPersistence(documentDatabaseName(id), doc)
    try {
      await persistence.whenSynced
      applyUpdate(doc, update)
      const merged = encodeStateAsUpdate(doc)
      const db = persistence.db
      if (!db) throw new Error('Local storage is unavailable.')
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('updates', 'readwrite')
        transaction.objectStore('updates').add(merged)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('Could not save document content.'),
          )
        transaction.onerror = () => reject(transaction.error)
      })
      publishDocumentUpdate(id, merged)
    } finally {
      await persistence.destroy()
      doc.destroy()
    }
  })
}

// Recovery metadata uses Concept identity; provider file IDs never key IndexedDB.
export async function storeDocumentInfo(document: DocumentInfo) {
  await query('readwrite', (store) => store.put(document))
  publishDocumentChange({ type: 'upsert', document })
  return document
}
