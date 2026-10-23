import { publishDocumentChange } from '../library-channel'
import type { DocumentInfo } from '../storage'

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

export const localMetadata = {
  get: (id: string) =>
    query<DocumentInfo | undefined>('readonly', (store) => store.get(id)),
  async list() {
    const documents = await query<Array<DocumentInfo>>('readonly', (store) =>
      store.getAll(),
    )
    return documents.sort((a, b) => b.updatedAt - a.updatedAt)
  },
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
  update: updateDocumentInfo,
  async delete(id: string) {
    await query('readwrite', (store) => store.delete(id))
    publishDocumentChange({ type: 'delete', id })
  },
}
