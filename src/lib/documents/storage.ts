import type { AssetId } from './assets'
import type { Doc } from 'yjs'

export interface DocumentInfo {
  id: string
  name: string
  updatedAt: number
  readOnly?: boolean
  recoveryMissingAssets?: AssetId[]
  importing?: boolean
  drive?: {
    publicAccess?: boolean
    resourceKey?: string
    accountId?: string
    quarantined?: boolean
    recoveryOnly?: boolean
    fileId: string
    offlineAvailable: boolean
    dirty?: boolean
    etag?: string
    revision?: string
    lastSyncedAt?: number
    savedRevision?: string
    remoteFilename?: string
    readOnly?: boolean
  }
}

export interface DocumentPersistence {
  whenSynced: Promise<unknown>
  flush?: () => Promise<void>
  destroy: () => Promise<void>
}

export type DocumentChange =
  { type: 'upsert'; document: DocumentInfo } | { type: 'delete'; id: string }

export interface DocumentStorage {
  subscribe: (listener: (change: DocumentChange) => void) => () => void
  list: () => Promise<Array<DocumentInfo>>
  get: (id: string) => Promise<DocumentInfo | undefined>
  create: () => Promise<DocumentInfo>
  rename: (id: string, name: string) => Promise<DocumentInfo>
  delete: (id: string) => Promise<void>
  open: (id: string, doc: Doc) => DocumentPersistence
}

export { localDocumentStorage } from './storages/local'
