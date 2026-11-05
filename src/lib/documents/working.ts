import type { Doc } from 'yjs'
import type { AssetId, AssetRepository } from './assets'
import { IncompleteAssetsError } from './package'
import type { NormalizedSnapshot } from './package'
import { captureDocument } from './references'

const recoveryAssets = new WeakMap<Doc, ReadonlyArray<AssetId>>()
export function setDocumentRecoveryAssets(
  doc: Doc,
  ids: ReadonlyArray<AssetId>,
) {
  recoveryAssets.set(doc, ids)
}

const repositories = new WeakMap<Doc, AssetRepository>()

export function attachDocumentAssets(doc: Doc, repository: AssetRepository) {
  repositories.set(doc, repository)
  return () => {
    if (repositories.get(doc) === repository) repositories.delete(doc)
  }
}

export function documentAssets(doc: Doc) {
  return repositories.get(doc)
}

export { IncompleteAssetsError } from './package'
export async function captureSnapshot(
  name: string,
  doc: Doc,
  allowIncomplete = false,
): Promise<NormalizedSnapshot> {
  const captured = captureDocument(doc, name)
  const repository = documentAssets(doc)
  const descriptors = repository ? await repository.list() : []
  const pin = repository?.pin(descriptors.map((descriptor) => descriptor.id))
  try {
    const assets = await Promise.all(
      descriptors.map(async (descriptor) => {
        const blob = await repository!.get(descriptor.id)
        if (!blob) throw new IncompleteAssetsError([descriptor.id])
        return { descriptor, blob }
      }),
    )
    const available = new Set(descriptors.map((descriptor) => descriptor.id))
    const missing = [
      ...captured.requiredAssets,
      ...(recoveryAssets.get(doc) ?? []),
    ].filter((id) => !available.has(id))
    if (missing.length && !allowIncomplete)
      throw new IncompleteAssetsError(missing)
    return {
      name: captured.name,
      update: captured.update,
      assets,
      requiredFeatures: [],
    }
  } finally {
    pin?.release()
  }
}
