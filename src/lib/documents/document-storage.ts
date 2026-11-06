import {
  getGoogleDriveAccountId,
  isGoogleDriveConnected,
  settleGoogleDriveSession,
} from './drive/auth'
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
  isPublicDriveFile,
  rememberPublicDriveFile,
  getDriveResourceKey,
  rememberDriveResourceKey,
  readConceptFile,
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
          publicAccess: isPublicDriveFile(file.id),
          resourceKey: getDriveResourceKey(file.id),
          accountId: getGoogleDriveAccountId(),
          fileId: file.id,
          offlineAvailable: false,
          readOnly: isReadOnly,
        },
      }
      await localDocumentStorage.patch(
        id,
        (current) =>
          current.drive?.accountId !== initial.drive.accountId
            ? current
            : {
                ...current,
                readOnly: isReadOnly,
                drive: current.drive
                  ? { ...current.drive, readOnly: isReadOnly }
                  : undefined,
                name: current.drive?.dirty ? current.name : initial.name,
                updatedAt: current.drive?.dirty
                  ? current.updatedAt
                  : initial.updatedAt,
              },
        initial,
      )
    }),
  )
  return new Set(files.map((file) => `G${file.id}`))
}

async function ensureDocument(id: string) {
  const existing = await localDocumentStorage.get(id)
  if (existing?.drive || id.startsWith('G')) await settleGoogleDriveSession()
  const accountId = getGoogleDriveAccountId()
  if (existing?.drive?.resourceKey)
    rememberDriveResourceKey(existing.drive.fileId, existing.drive.resourceKey)
  if (existing?.drive?.publicAccess)
    rememberPublicDriveFile(existing.drive.fileId)
  if (existing?.drive?.recoveryOnly) {
    if (existing.drive.accountId !== accountId)
      throw new Error(
        'This cached document belongs to a different Google account.',
      )
    return existing
  }
  if (existing?.drive && existing.drive.accountId !== accountId) {
    // Read as the new account before moving any previously cached bytes.
    const remote = await readConceptFile(existing.drive.fileId)
    if (accountId !== getGoogleDriveAccountId())
      throw new Error(
        'Google account changed. Try opening this document again.',
      )
    await documentSessions.get(id)?.stop()
    const replacement = await localDocumentStorage.archiveAccountCache(id, {
      id,
      name: remote.file.name.replace(/\.concept$/i, ''),
      updatedAt: Date.parse(remote.file.modifiedTime ?? '') || Date.now(),
      readOnly: isDriveFileReadOnly(remote.file),
      drive: {
        fileId: remote.file.id,
        accountId,
        publicAccess:
          isPublicDriveFile(remote.file.id) || !isGoogleDriveConnected(),
        resourceKey: getDriveResourceKey(remote.file.id),
        offlineAvailable: false,
        readOnly: isDriveFileReadOnly(remote.file),
      },
    })
    clearSaveStatus(id)
    return replacement
  }
  if (
    existing?.drive &&
    !accountId &&
    !isGoogleDriveConnected() &&
    !existing.drive.publicAccess
  ) {
    const remote = await readConceptFile(existing.drive.fileId)
    if (accountId !== getGoogleDriveAccountId())
      throw new Error(
        'Google account changed. Try opening this document again.',
      )
    rememberPublicDriveFile(existing.drive.fileId)
    await documentSessions.get(id)?.stop()
    const replacement = await localDocumentStorage.archiveAccountCache(
      id,
      {
        id,
        name: remote.file.name.replace(/\.concept$/i, ''),
        updatedAt: Date.parse(remote.file.modifiedTime ?? '') || Date.now(),
        readOnly: isDriveFileReadOnly(remote.file),
        drive: {
          fileId: remote.file.id,
          publicAccess: true,
          accountId,
          resourceKey: getDriveResourceKey(remote.file.id),
          offlineAvailable: false,
          readOnly: isDriveFileReadOnly(remote.file),
        },
      },
      true,
    )
    clearSaveStatus(id)
    return replacement
  }
  if (existing || !id.startsWith('G')) return existing
  const { file } = await getFileMetadata(id.slice(1))
  const isReadOnly = isDriveFileReadOnly(file)
  const info = {
    id,
    name: file.name.replace(/\.concept$/i, ''),
    updatedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
    readOnly: isReadOnly,
    drive: {
      publicAccess: isPublicDriveFile(file.id) || !isGoogleDriveConnected(),
      resourceKey: getDriveResourceKey(file.id),
      accountId: getGoogleDriveAccountId(),
      fileId: file.id,
      offlineAvailable: false,
      readOnly: isReadOnly,
    },
  }
  return localDocumentStorage.patch(id, (current) => current, info)
}

export const documentStorage: DocumentStorage = {
  ...localDocumentStorage,
  get: ensureDocument,
  subscribe(listener) {
    return localDocumentStorage.subscribe((change) => {
      if (
        change.type === 'delete' ||
        !change.document.drive ||
        change.document.drive.accountId === getGoogleDriveAccountId()
      )
        listener(change)
    })
  },
  async list() {
    return (await localDocumentStorage.list()).filter(
      (info) =>
        !info.drive || info.drive.accountId === getGoogleDriveAccountId(),
    )
  },
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
    const info = await ensureDocument(id)
    if (
      info?.drive &&
      !info.drive.recoveryOnly &&
      !info.drive.publicAccess &&
      !info.readOnly &&
      !info.drive.readOnly
    ) {
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
  open: openDocumentSession,
}

function openDocumentSession(id: string, doc: Doc, background = false) {
  let local: DocumentPersistence | undefined
  let sync: DocumentSync | undefined
  let closed = false
  let closing: Promise<void> | undefined
  const isClosed = () => closed
  const whenSynced = (async () => {
    const info = await ensureDocument(id)
    if (!info || isClosed()) throw new Error('Document not found')
    if (info.drive?.recoveryOnly)
      throw new Error(
        'Recover this archived document as a local copy before opening it.',
      )
    local = localDocumentStorage.open(id, doc)
    await local.whenSynced
    if (isClosed()) return
    sync = new DocumentSync(
      info,
      doc,
      local,
      info.drive ? openPublicationTransport(info.drive.fileId) : undefined,
      background,
    )
    await sync.start()
  })()
  return {
    whenSynced,
    async setOfflineAvailable(value: boolean) {
      await whenSynced
      if (!sync)
        throw new Error('Could not prepare this document for offline use.')
      await sync.setOfflineAvailable(value)
    },
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
}

const offlineChanges = new Map<string, Promise<void>>()

export function setDocumentOfflineAvailable(id: string, value: boolean) {
  const previous = offlineChanges.get(id) ?? Promise.resolve()
  const changing = previous
    .catch(() => {})
    .then(async () => {
      const info = await ensureDocument(id)
      if (!info?.drive) return
      const active = documentSessions.get(id)
      if (active) {
        await active.setOfflineAvailable(value)
        return
      }
      if (!value) {
        await localDocumentStorage.patch(id, (current) => ({
          ...current,
          drive: current.drive
            ? { ...current.drive, offlineAvailable: false }
            : undefined,
        }))
        await localDocumentStorage.clearContent(id)
        return
      }
      const doc = new Doc()
      const session = openDocumentSession(id, doc, true)
      try {
        await session.setOfflineAvailable(true)
        await documentSessions.get(id)?.setOfflineAvailable(true)
      } finally {
        await session.destroy()
        doc.destroy()
      }
    })
  offlineChanges.set(id, changing)
  void changing
    .finally(() => {
      if (offlineChanges.get(id) === changing) offlineChanges.delete(id)
    })
    .catch(() => {})
  return changing
}

export async function recoverDocumentLocally(id: string) {
  const source = await localDocumentStorage.get(id)
  if (!source?.drive) throw new Error('Shared document not found.')
  if (source.drive.accountId !== getGoogleDriveAccountId())
    throw new Error(
      'This cached document belongs to a different Google account.',
    )
  const doc = new Doc()
  const local = localDocumentStorage.open(id, doc)
  let target:
    Awaited<ReturnType<typeof localDocumentStorage.createStaged>> | undefined
  let targetSession: DocumentPersistence | undefined
  try {
    await local.whenSynced
    target = await localDocumentStorage.createStaged()
    const { copyDocumentAssets } = await import('./assets')
    await copyDocumentAssets(id, target.id)
    const recovered = new Doc()
    targetSession = localDocumentStorage.open(target.id, recovered)
    try {
      await targetSession.whenSynced
      const { applyUpdate, encodeStateAsUpdate } = await import('yjs')
      applyUpdate(recovered, encodeStateAsUpdate(doc))
      const name = `${documentName(doc, source.name)} (recovered)`
      recovered.getMap<string>('metadata').set('name', name)
      await targetSession.flush?.()
      const info = {
        ...target,
        name,
        importing: false,
        recoveryMissingAssets: source.recoveryMissingAssets,
      }
      await localDocumentStorage.put(info)
      await local.destroy()
      await documentSessions.get(id)?.stop()
      if (source.drive.recoveryOnly) await localDocumentStorage.delete(id)
      else await localDocumentStorage.resetRecoveredContent(id).catch(() => {})
      return info
    } finally {
      await targetSession.destroy()
      targetSession = undefined
      recovered.destroy()
    }
  } catch (error) {
    await targetSession?.destroy()
    if (target) await localDocumentStorage.delete(target.id).catch(() => {})
    throw error
  } finally {
    await local.destroy()
    doc.destroy()
  }
}

export async function recheckDocumentAccess(id: string) {
  const info = await localDocumentStorage.get(id)
  if (!info?.drive) throw new Error('Shared document not found.')
  if (info.drive.accountId !== getGoogleDriveAccountId())
    throw new Error(
      'This cached document belongs to a different Google account.',
    )
  if (info.drive.publicAccess) rememberPublicDriveFile(info.drive.fileId)
  await readConceptFile(info.drive.fileId)
  if (info.drive.quarantined)
    throw new Error(
      'Recover your unsynced work as a local copy before reopening this shared file.',
    )
  clearSaveStatus(id)
}
