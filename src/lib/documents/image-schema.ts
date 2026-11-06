import { isAssetId } from './assets'
import type { AssetId } from './assets'

export const imageDimensionLimit = 16384
export const imagePixelLimit = 40_000_000
export const imageMinimumDisplayWidth = 32

export interface ImageSource {
  readonly assetId: AssetId
  readonly intrinsicWidth: number
  readonly intrinsicHeight: number
}

export function validateImageSource(value: unknown): ImageSource {
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid image source')
  const source = value as Partial<ImageSource>
  const validDimension = (dimension: unknown): dimension is number =>
    typeof dimension === 'number' &&
    Number.isInteger(dimension) &&
    dimension > 0 &&
    dimension <= imageDimensionLimit
  if (
    !isAssetId(source.assetId) ||
    !validDimension(source.intrinsicWidth) ||
    !validDimension(source.intrinsicHeight) ||
    source.intrinsicWidth * source.intrinsicHeight > imagePixelLimit
  )
    throw new Error('Invalid image source')
  return Object.freeze({
    assetId: source.assetId,
    intrinsicWidth: source.intrinsicWidth,
    intrinsicHeight: source.intrinsicHeight,
  })
}

export function validateImageDisplayWidth(value: unknown): number | null {
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > imageDimensionLimit
  )
    throw new Error('Invalid image display width')
  return value
}
