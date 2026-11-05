import { normalizeAssetMediaType } from '#/lib/documents/assets'
import { createAssetObjectUrl } from '#/lib/documents/asset-session'
import { packageLimits } from '#/lib/documents/limits'

export const imageLimits = {
  bytes: Math.min(20 * 1024 * 1024, packageLimits.assetBytes),
  dimension: 16384,
  pixels: 40_000_000,
  files: 16,
  concurrentPreparations: 2,
  animatedBytes: 8 * 1024 * 1024,
}

export class ImagePreparationError extends Error {
  constructor(
    readonly code: 'unsupported' | 'size' | 'dimensions' | 'decode' | 'count',
  ) {
    super(
      {
        unsupported: 'Choose a PNG, JPEG, GIF, or WebP image.',
        size: 'This image exceeds the image size limit.',
        dimensions: 'This image exceeds the image dimension limit.',
        decode: 'This image could not be decoded.',
        count: `Choose up to ${imageLimits.files} images at once.`,
      }[code],
    )
    this.name = 'ImagePreparationError'
  }
}

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

export function validateImageDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > imageLimits.dimension ||
    height > imageLimits.dimension ||
    width * height > imageLimits.pixels
  )
    throw new ImagePreparationError('dimensions')
}

function headerDimensions(
  bytes: Uint8Array,
  mediaType: string,
): [number, number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mediaType === 'image/png' && bytes.length >= 24)
    return [view.getUint32(16), view.getUint32(20)]
  if (mediaType === 'image/gif' && bytes.length >= 10)
    return [view.getUint16(6, true), view.getUint16(8, true)]
  if (mediaType === 'image/jpeg') {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      )
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)]
      offset += length
    }
  }
  if (mediaType === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === 'VP8X') {
      const uint24 = (offset: number) =>
        bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
      return [uint24(24) + 1, uint24(27) + 1]
    }
    if (
      chunk === 'VP8 ' &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    )
      return [
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      ]
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
    }
  }
}

async function decodeImage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<[number, number]> {
  const objectUrl = createAssetObjectUrl(blob)
  const image = new Image()
  image.decoding = 'async'
  const abort = () => {
    image.src = ''
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    image.src = objectUrl.url
    await image.decode()
    signal?.throwIfAborted()
    // Browser natural dimensions apply EXIF orientation, as does the rendered img.
    return [image.naturalWidth, image.naturalHeight]
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof ImagePreparationError) throw error
    throw new ImagePreparationError('decode')
  } finally {
    signal?.removeEventListener('abort', abort)
    image.src = ''
    objectUrl.dispose()
  }
}

export async function prepareImage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<PreparedImage> {
  signal?.throwIfAborted()
  if (!blob.size || blob.size > imageLimits.bytes)
    throw new ImagePreparationError('size')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  signal?.throwIfAborted()
  const mediaType = normalizeAssetMediaType(bytes)
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)
  )
    throw new ImagePreparationError('unsupported')
  const animated =
    mediaType === 'image/gif' ||
    (mediaType === 'image/webp' &&
      bytes[12] === 86 &&
      bytes[15] === 88 &&
      Boolean(bytes[20] & 2)) ||
    (mediaType === 'image/png' &&
      bytes.some(
        (_, i) =>
          bytes[i] === 97 &&
          bytes[i + 1] === 99 &&
          bytes[i + 2] === 84 &&
          bytes[i + 3] === 76,
      ))
  if (animated && blob.size > imageLimits.animatedBytes)
    throw new ImagePreparationError('size')
  const dimensions = headerDimensions(bytes, mediaType)
  if (dimensions) validateImageDimensions(...dimensions)
  const normalized = new Blob([bytes], { type: mediaType })
  const [width, height] = await decodeImage(normalized, signal)
  validateImageDimensions(width, height)
  return { blob: normalized, width, height }
}

export async function prepareImages(
  blobs: ReadonlyArray<Blob>,
  signal?: AbortSignal,
) {
  if (blobs.length > imageLimits.files) throw new ImagePreparationError('count')
  const results: Array<PreparedImage | undefined> = new Array(blobs.length)
  const failures: Array<unknown> = new Array(blobs.length)
  let next = 0
  await Promise.all(
    Array.from(
      { length: Math.min(blobs.length, imageLimits.concurrentPreparations) },
      async () => {
        while (next < blobs.length) {
          const index = next++
          try {
            results[index] = await prepareImage(blobs[index], signal)
          } catch (error) {
            signal?.throwIfAborted()
            failures[index] = error
          }
        }
      },
    ),
  )
  return {
    images: results.filter((value): value is PreparedImage => Boolean(value)),
    rejected: failures.filter((value) => value !== undefined),
  }
}
