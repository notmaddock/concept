import type { Doc } from 'yjs'

export interface DocumentInfo {
  id: string
  name: string
  updatedAt: number
}

export interface DocumentPersistence {
  whenSynced: Promise<unknown>
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
