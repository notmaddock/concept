import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type { DocumentPersistence } from '../storage'
import { documentChannelName, remoteDocumentOrigin } from '../document-channel'
import type { DocumentChannelMessage } from '../document-channel'
import { localMetadata } from './local-metadata'

const activeSessions = new Map<string, Set<DocumentPersistence>>()
const activeDocuments = new Map<string, Map<DocumentPersistence, Doc>>()

function documentDatabaseName(id: string) {
  return `concept-document:${id}`
}

export async function removeDocumentContent(id: string) {
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
export function withDocumentLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
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

export function openDocument(id: string, doc: Doc): DocumentPersistence {
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
    const document = await localMetadata.get(id)
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

// y-indexeddb does not observe writes from another persistence instance.
export function publishDocumentUpdate(
  id: string,
  update: Uint8Array,
  origin: unknown = remoteDocumentOrigin,
) {
  for (const doc of new Set(activeDocuments.get(id)?.values()))
    applyUpdate(doc, update, origin)
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(documentChannelName(id))
    const message: DocumentChannelMessage = {
      type: 'update',
      update,
      ...(origin === remoteDocumentOrigin ? { synced: true } : {}),
    }
    channel.postMessage(message)
    channel.close()
  }
}

// Imports share the lifecycle lock with opening/deleting document content.
export function persistDocumentUpdate(id: string, update: Uint8Array) {
  return withDocumentLock(id, async () => {
    if (!(await localMetadata.get(id))) throw new Error('Document not found')
    const { IndexeddbPersistence } = await import('y-indexeddb')
    const doc = new Doc()
    const persistence = new IndexeddbPersistence(documentDatabaseName(id), doc)
    try {
      await persistence.whenSynced
      applyUpdate(doc, update, persistence)
      const merged = encodeStateAsUpdate(doc)
      const db = persistence.db
      if (!db) throw new Error('Local storage is unavailable.')
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('updates', 'readwrite')
        const store = transaction.objectStore('updates')
        store.clear()
        store.add(merged)
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
