import { createContext, useContext } from 'react'
import type { Doc } from 'yjs'
import type { AssetDescriptor } from '#/lib/documents/assets'
import type {
  AssetInsertionOutcome,
  DocumentAssetResolver,
} from '#/lib/documents/asset-session'

export interface DocumentMediaSession {
  documentId: string
  doc: Doc
  signal: AbortSignal
  canEdit: () => boolean
  isAlive: () => boolean
  resolver?: DocumentAssetResolver
  flush: () => Promise<void>
  requestSave: () => void
  insert: (
    blobs: ReadonlyArray<Blob>,
    commit: (descriptors: ReadonlyArray<AssetDescriptor>) => void,
  ) => Promise<AssetInsertionOutcome>
}

export const DocumentMediaContext = createContext<DocumentMediaSession | null>(
  null,
)
export const useDocumentMedia = () => useContext(DocumentMediaContext)
