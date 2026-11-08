import type { Doc } from 'yjs'
import type { AssetId, AssetRepository } from './assets'
import { IncompleteAssetsError } from './package'
import type { NormalizedSnapshot, PackageAsset } from './package'
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
): Promise<NormalizedSnapshot> {
  const captured = captureDocument(doc, name)
  const repository = documentAssets(doc)
  const descriptors = repository ? await repository.list() : []
  const pin = repository?.pin(descriptors.map((descriptor) => descriptor.id))
  try {
    const requiredIds = new Set<AssetId>([
      ...captured.requiredAssets,
      ...(recoveryAssets.get(doc) ?? []),
    ])
    const available = new Set(descriptors.map((descriptor) => descriptor.id))
    const missing = [...requiredIds].filter((id) => !available.has(id))
    const assets: PackageAsset[] = []
    await Promise.all(
      descriptors.map(async (descriptor) => {
        const blob = await repository!.get(descriptor.id)
        if (!blob) {
          if (requiredIds.has(descriptor.id)) {
            missing.push(descriptor.id)
          }
        } else {
          assets.push({ descriptor, blob })
        }
      }),
    )
    if (missing.length) {
      const error = new IncompleteAssetsError(Array.from(new Set(missing)))
      throw Object.assign(error, {
        snapshot: {
          name: captured.name,
          update: captured.update,
          assets,
          requiredFeatures: [],
        },
      })
    }
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

export async function captureRevisionSnapshot(name: string, doc: Doc) {
  const captured = captureDocument(doc, name)
  const descriptors = (await documentAssets(doc)?.list()) ?? []
  return {
    name: captured.name,
    update: captured.update,
    assets: descriptors.map((descriptor) => ({ descriptor })),
    requiredFeatures: [],
  }
}
