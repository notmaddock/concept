import { isAssetId, normalizeAssetMediaType } from './assets'
import type { AssetId } from './assets'
import type { DocumentAssetResolver } from './asset-session'

export const imageTransferLimits = {
  bytes: 32 * 1024 * 1024,
  assets: 64,
  nodes: 10000,
  depth: 64,
  pixels: 80_000_000,
}

export async function imageDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${normalizeAssetMediaType(bytes)};base64,${btoa(binary)}`
}

export function imageDataBlob(value: string): Blob {
  if (value.length > imageTransferLimits.bytes * 1.4)
    throw new Error('Image transfer is too large.')
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      value,
    )
  if (!match) throw new Error('Unsupported embedded image.')
  const binary = atob(match[2])
  return new Blob(
    [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
    { type: match[1] },
  )
}

export async function resolveImageData(
  ids: Iterable<AssetId>,
  resolver?: DocumentAssetResolver,
  allowMissing = false,
): Promise<Map<AssetId, string | null>> {
  const unique = [...new Set(ids)]
  if (unique.length > imageTransferLimits.assets)
    throw new Error(
      'Too many images to transfer. Download a Concept document instead.',
    )
  const result = new Map<AssetId, string | null>()
  let bytes = 0
  let pixels = 0
  for (const id of unique) {
    const state = await resolver?.resolve(id)
    if (state?.state !== 'available') {
      if (!allowMissing)
        throw new Error(
          'Some images are unavailable. Retry after restoring them.',
        )
      result.set(id, null)
      continue
    }
    const { prepareImage } = await import('#/components/nova/images/ingestion')
    try {
      const image = await prepareImage(state.blob)
      pixels += image.width * image.height
    } catch (error) {
      if (!allowMissing) throw error
      result.set(id, null)
      continue
    }
    if (pixels > imageTransferLimits.pixels)
      throw new Error('Too many image pixels to transfer.')
    bytes += state.blob.size
    if (bytes > imageTransferLimits.bytes)
      throw new Error(
        'Images are too large to transfer. Download a Concept document instead.',
      )
    result.set(id, await imageDataUrl(state.blob))
  }
  return result
}

export function imageElements(root: ParentNode) {
  return [
    ...root.querySelectorAll<HTMLImageElement>(
      'img[data-concept-image-asset-id]',
    ),
  ].map((element) => {
    const id = element.getAttribute('data-concept-image-asset-id')
    if (!isAssetId(id)) throw new Error('Invalid image reference.')
    return { element, id }
  })
}

export function embedImageData(
  html: string,
  data: ReadonlyMap<AssetId, string | null>,
) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const { element, id } of imageElements(document)) {
    const value = data.get(id)
    if (value) element.src = value
    else {
      const placeholder = document.createElement('span')
      placeholder.textContent = element.alt
        ? `[Image: ${element.alt}]`
        : '[Image]'
      element.replaceWith(placeholder)
    }
  }
  return document.body.innerHTML
}
