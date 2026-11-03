import { Doc } from 'yjs'
import { toast } from 'sonner'
import { localDocumentStorage } from './storage'
import type { DocumentStorage, DocumentPersistence } from './storage'
import { DocumentSync, documentName, documentSessions } from './sync'
import {
  getFileMetadata,
  listConceptFiles,
  trashConceptFile,
} from './drive/api'

export async function refreshDriveDocuments() {
  const files = await listConceptFiles()
  await Promise.all(
    files.map(async (file) => {
      const id = `G${file.id}`
      const initial = {
        id,
        name: file.name.replace(/\.concept$/i, ''),
        updatedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
        drive: { fileId: file.id, offlineAvailable: false },
      }
      await localDocumentStorage.patch(
        id,
        (current) => ({
          ...current,
          name: current.drive?.dirty ? current.name : initial.name,
          updatedAt: current.drive?.dirty
            ? current.updatedAt
            : initial.updatedAt,
        }),
        initial,
      )
    }),
  )
  return new Set(files.map((file) => `G${file.id}`))
}

async function ensureDocument(id: string) {
  const existing = await localDocumentStorage.get(id)
  if (existing || !id.startsWith('G')) return existing
  const { file } = await getFileMetadata(id.slice(1))
  const info = {
    id,
    name: file.name.replace(/\.concept$/i, ''),
    updatedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
    drive: { fileId: file.id, offlineAvailable: false },
  }
  return localDocumentStorage.patch(id, (current) => current, info)
}

export const documentStorage: DocumentStorage = {
  ...localDocumentStorage,
  get: ensureDocument,
  async rename(id, name) {
    const info = await ensureDocument(id)
    const active = documentSessions.get(id)
    if (active) {
      active.doc
        .getMap<string>('metadata')
        .set('name', name.trim() || 'Untitled document')
      return localDocumentStorage.rename(id, documentName(active.doc, name))
    }
    if (!info?.drive) return localDocumentStorage.rename(id, name)
    const doc = new Doc()
    const session = documentStorage.open(id, doc)
    try {
      await session.whenSynced.catch((cause: unknown) => {
        toast.error('Could not rename the file on Google Drive.', {
          id: `drive-rename:${id}`,
        })
        throw cause
      })
      doc
        .getMap<string>('metadata')
        .set('name', name.trim() || 'Untitled document')
      await session.flush?.()
      await documentSessions.get(id)?.sync()
      return await localDocumentStorage.rename(id, documentName(doc, name))
    } finally {
      await session.destroy()
      doc.destroy()
    }
  },
  async delete(id) {
    const info = await localDocumentStorage.get(id)
    if (info?.drive) await trashConceptFile(info.drive.fileId)
    await localDocumentStorage.delete(id)
  },
  open(id, doc) {
    let local: DocumentPersistence | undefined
    let sync: DocumentSync | undefined
    let closed = false
    let closing: Promise<void> | undefined
    const isClosed = () => closed
    const whenSynced = (async () => {
      const info = await ensureDocument(id)
      if (!info || isClosed()) throw new Error('Document not found')
      local = localDocumentStorage.open(id, doc)
      await local.whenSynced
      if (isClosed()) return
      sync = new DocumentSync(info, doc, local)
      await sync.start()
    })()
    return {
      whenSynced,
      async flush() {
        await whenSynced
        await local?.flush?.()
      },
      destroy() {
        closed = true
        const stopping = sync?.stop()
        closing ??= (async () => {
          await whenSynced.catch(() => {})
          await stopping
          await local?.destroy()
          await localDocumentStorage.clearContent(id)
        })()
        return closing
      },
    }
  },
}
