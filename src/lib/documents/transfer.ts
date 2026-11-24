import { Doc, encodeStateAsUpdate } from 'yjs'
import type { LucideIcon } from 'lucide-react'
import { storageLocations } from './storage-locations'
import type { AssetId } from './assets'
import type { NormalizedSnapshot } from './package'
import type { MarkdownWarning } from './markdown-transformers'
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

// Estimates the writePackage output size without serializing or hashing the
// snapshot (SHA-256 per asset plus the update) just for a display number.
// Each zip entry adds a 30-byte local header plus a 46-byte central-directory
// record, each repeating the path, and the package ends with a 22-byte
// end-of-central-directory record — the same accounting writePackage applies.
// The manifest allowance errs high (fixed boilerplate 448, a JSON-escaped
// name, 320 per asset descriptor) so size-based limits see an over-estimate.
const estimatedPackageSize = (snapshot: NormalizedSnapshot): number => {
  let total =
    snapshot.update.byteLength +
    22 +
    76 +
    2 * 'manifest.json'.length +
    76 +
    2 * 'document.yjs'.length +
    448 +
    6 * snapshot.name.length
  for (const { blob, descriptor } of snapshot.assets) {
    // Asset paths are "assets/" plus the id digest, so id.length covers them.
    total += blob.size + 76 + 2 * descriptor.id.length + 320
  }
  return total
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
          return {
            file: snapshot,
            filename: document.name,
            size: estimatedPackageSize(snapshot),
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
