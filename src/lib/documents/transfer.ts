import { Doc, encodeStateAsUpdate } from 'yjs'
import type { LucideIcon } from 'lucide-react'
import { storageLocations } from './storage-locations'
import type { AssetId } from './assets'
import type { NormalizedSnapshot } from './package'
import type { MarkdownWarning } from './markdown-transformers'
import { writePackage } from './package'
import { captureSnapshot, IncompleteAssetsError } from './working'
import type { DocumentInfo } from './storage'
import { importConcept } from './concept-file'
import { localDocumentStorage } from './storage'
import { initializeDocument } from './initial-document'

export interface SelectedDocument {
  file: NormalizedSnapshot
  filename: string
  size: number
  origin: string
  existingId?: string
  missingAssets?: AssetId[]
  warnings?: MarkdownWarning[]
}

interface SourceInfo {
  id: string
  label: string
  description: string
  icon: LucideIcon
}

export type DocumentSource = SourceInfo &
  (
    | { kind: 'device' }
    | {
        kind: 'library'
        list: () => Promise<Array<DocumentInfo>>
        read: (document: DocumentInfo) => Promise<SelectedDocument>
      }
  )

export interface DocumentSaveProvider extends SourceInfo {
  save: (
    file: NormalizedSnapshot,
    name: string,
    missingAssets?: AssetId[],
  ) => Promise<DocumentInfo>
}

export const documentSources: Array<DocumentSource> = [
  {
    ...storageLocations.device,
    kind: 'device',
  },
  {
    ...storageLocations.local,
    kind: 'library',
    list: () => localDocumentStorage.list(),
    async read(document) {
      const doc = new Doc()
      const session = localDocumentStorage.open(document.id, doc)
      try {
        await session.whenSynced
        if (!doc.share.has('root')) initializeDocument(doc)
        let snapshot: NormalizedSnapshot | undefined
        try {
          snapshot = await captureSnapshot(document.name, doc)
          const content = await writePackage(snapshot)
          return {
            file: snapshot,
            filename: document.name,
            size: content.byteLength,
            origin: storageLocations.local.label,
            existingId: document.id,
          }
        } catch (error) {
          if (error instanceof IncompleteAssetsError) {
            const fallbackSnapshot: NormalizedSnapshot =
              snapshot ??
              ('snapshot' in error && error.snapshot
                ? (error.snapshot as NormalizedSnapshot)
                : {
                    name: document.name.trim() || 'Untitled document',
                    update: encodeStateAsUpdate(doc),
                    assets: [],
                    requiredFeatures: [],
                  })
            const size =
              fallbackSnapshot.update.byteLength +
              fallbackSnapshot.assets.reduce(
                (total, asset) => total + asset.blob.size,
                0,
              )
            return {
              file: fallbackSnapshot,
              filename: document.name,
              size,
              origin: storageLocations.local.label,
              existingId: document.id,
              missingAssets: [...error.missingAssets],
            }
          }
          throw error
        }
      } finally {
        await session.destroy()
        doc.destroy()
      }
    },
  },
]

export const documentSaveProviders: Array<DocumentSaveProvider> = [
  {
    ...storageLocations.local,
    save: (file, name, missingAssets) =>
      importConcept(file, name, missingAssets),
  },
]
