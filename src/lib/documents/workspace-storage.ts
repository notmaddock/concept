import { applyUpdate } from 'yjs'
import { localDocumentStorage } from './storage'
import type { DocumentStorage, DocumentSyncStatus } from './storage'
import { storeDocumentInfo } from './storages/local'
import { serializeConcept } from './serialization'

// The editor opens a storage session without knowing its backing provider.
// IndexedDB is always ready first, including offline or after signing out.
export const workspaceDocumentStorage: DocumentStorage = {
  ...localDocumentStorage,
  open(id, doc) {
    const local = localDocumentStorage.open(id, doc)
    const listeners = new Set<(status: DocumentSyncStatus) => void>()
    let status: DocumentSyncStatus = {
      state: 'local',
      message: 'Stored in this browser.',
    }
    let closed = false
    let dirty = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const isClosed = () => closed
    const hasChanges = () => dirty
    let unsubscribe: (() => void) | undefined
    const remoteOrigin = {}
    function report(next: DocumentSyncStatus) {
      status = next
      listeners.forEach((listener) => listener(status))
    }
    function schedule() {
      if (isClosed()) return
      dirty = true
      report({
        state: navigator.onLine ? 'pending' : 'offline',
        message: navigator.onLine
          ? 'Changes are stored in this browser and waiting to save to Google Drive.'
          : 'You’re offline. Changes stay in this browser and will save to Google Drive when you reconnect.',
      })
      clearTimeout(timer)
      timer = setTimeout(() => void sync(), 1000)
    }
    function changed(_update: Uint8Array, origin: unknown) {
      if (origin !== remoteOrigin) schedule()
    }
    async function sync() {
      if (isClosed() || running || !hasChanges()) return
      running = true
      dirty = false
      try {
        const document = await localDocumentStorage.get(id)
        if (document?.backing?.provider !== 'google-drive' || isClosed()) return
        report({ state: 'syncing', message: 'Saving to Google Drive…' })
        const { saveDrive } = await import('./drive/functions')
        if (isClosed()) return
        const remote = await saveDrive({
          data: {
            id,
            name: document.name,
            text: serializeConcept(document.name, doc),
            previousName: document.backing.syncedName,
            ...document.backing,
          },
        })
        if (isClosed()) return
        applyUpdate(
          doc,
          Uint8Array.from(atob(remote.file.update), (character) =>
            character.charCodeAt(0),
          ),
          remoteOrigin,
        )
        const current = await localDocumentStorage.get(id)
        if (current && !isClosed()) {
          await storeDocumentInfo({
            ...remote.document,
            name:
              current.name === document.name
                ? remote.document.name
                : current.name,
          })
        }
        if (!hasChanges())
          report({
            state: 'synced',
            message:
              'Saved to Google Drive. A recovery copy is stored in this browser.',
          })
      } catch (cause) {
        dirty = true
        if (!isClosed())
          report({
            state: navigator.onLine ? 'error' : 'offline',
            message: `Changes are stored in this browser. ${cause instanceof Error ? cause.message : 'Could not save to Google Drive.'}`,
          })
      } finally {
        running = false
        if (hasChanges() && !isClosed()) {
          clearTimeout(timer)
          timer = setTimeout(() => void sync(), 30_000)
        }
      }
    }
    const retry = () => {
      if (hasChanges()) void sync()
    }
    void local.whenSynced
      .then(async () => {
        const document = await localDocumentStorage.get(id)
        if (document?.backing?.provider !== 'google-drive' || isClosed()) return
        let name = document.name
        doc.on('update', changed)
        unsubscribe = localDocumentStorage.subscribe((change) => {
          if (change.type === 'delete' && change.id === id)
            void session.destroy()
          if (
            change.type === 'upsert' &&
            change.document.id === id &&
            change.document.name !== name
          ) {
            name = change.document.name
            // Remote metadata refreshes already reflect a completed upload.
            if (name !== change.document.backing?.syncedName) schedule()
          }
        })
        window.addEventListener('online', retry)
        window.addEventListener('focus', retry)
        // Merge remote Yjs state before replacing the existing Drive file.
        schedule()
      })
      .catch(() => {})
    const session = {
      whenSynced: local.whenSynced,
      retrySync: retry,
      subscribeStatus(listener: (value: DocumentSyncStatus) => void) {
        listeners.add(listener)
        listener(status)
        return () => {
          listeners.delete(listener)
        }
      },
      async destroy() {
        closed = true
        clearTimeout(timer)
        doc.off('update', changed)
        unsubscribe?.()
        window.removeEventListener('online', retry)
        window.removeEventListener('focus', retry)
        listeners.clear()
        await local.destroy()
      },
    }
    return session
  },
}
