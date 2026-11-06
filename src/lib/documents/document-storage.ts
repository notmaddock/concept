import { openPublicationTransport } from './publication'
import { Doc } from 'yjs'
import { localDocumentStorage } from './storage'
import type { DocumentStorage, DocumentPersistence } from './storage'
import {
  clearSaveStatus,
  DocumentSync,
  documentName,
  documentSessions,
} from './sync'
import {
  DriveError,
  getFileMetadata,
  isDriveFileReadOnly,
  listConceptFiles,
  trashConceptFile,
} from './drive/api'

export async function refreshDriveDocuments() {
  const files = await listConceptFiles()
  await Promise.all(
    files.map(async (file) => {
      const id = `G${file.id}`
      const isReadOnly = isDriveFileReadOnly(file)
      const initial = {
        id,
        name: file.name.replace(/\.concept$/i, ''),
        updatedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
        readOnly: isReadOnly,
        drive: {
          fileId: file.id,
          offlineAvailable: false,
          readOnly: isReadOnly,
        },
      }
      await localDocumentStorage.patch(
        id,
        (current) => ({
          ...current,
          readOnly: isReadOnly,
          drive: current.drive
            ? { ...current.drive, readOnly: isReadOnly }
            : undefined,
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
  const isReadOnly = isDriveFileReadOnly(file)
  const info = {
    id,
    name: file.name.replace(/\.concept$/i, ''),
    updatedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
    readOnly: isReadOnly,
    drive: { fileId: file.id, offlineAvailable: false, readOnly: isReadOnly },
  }
  return localDocumentStorage.patch(id, (current) => current, info)
}

export const documentStorage: DocumentStorage = {
  ...localDocumentStorage,
  get: ensureDocument,
  async rename(id, name) {
    const info = await ensureDocument(id)
    const active = documentSessions.get(id)
    if (info?.readOnly || info?.drive?.readOnly || active?.isReadOnly) {
      throw new Error('This document is view-only and cannot be renamed.')
    }
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
      await session.whenSynced
      if (documentSessions.get(id)?.isReadOnly)
        throw new Error('This document is view-only and cannot be renamed.')
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
    if (info?.drive && !info.readOnly && !info.drive.readOnly) {
      try {
        await trashConceptFile(info.drive.fileId)
      } catch (error) {
        if (
          !(error instanceof DriveError && error.status === 404) &&
          !(
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            error.status === 404
          )
        ) {
          throw error
        }
      }
    }
    await documentSessions.get(id)?.stop()
    await localDocumentStorage.delete(id)
    clearSaveStatus(id)
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
      sync = new DocumentSync(
        info,
        doc,
        local,
        info.drive ? openPublicationTransport(info.drive.fileId) : undefined,
      )
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
