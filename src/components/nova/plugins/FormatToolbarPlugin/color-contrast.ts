import type { RGB } from '#/lib/color'

export { contrastRatio, readableColor } from '#/lib/color'
export type { RGB } from '#/lib/color'

let colorContext: CanvasRenderingContext2D | null | undefined

export function cssRGB(color: string, background?: RGB): RGB {
  // Canvas resolves theme colors (including oklch) through the browser's color engine.
  if (!colorContext) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    colorContext = canvas.getContext('2d', { willReadFrequently: true })
  }
  const context = colorContext!
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = '#000000'
  if (background) {
    context.fillStyle = `rgb(${background.join(', ')})`
    context.fillRect(0, 0, 1, 1)
  }
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

export function elementBackground(
  element: HTMLElement | null,
  cache?: Map<HTMLElement, RGB>,
): RGB {
  if (!element) return [255, 255, 255]
  const cached = cache?.get(element)
  if (cached) return cached
  const color = getComputedStyle(element).backgroundColor
  const parent = elementBackground(element.parentElement, cache)
  const background =
    color === 'rgba(0, 0, 0, 0)' || color === 'transparent'
      ? parent
      : cssRGB(color, parent)
  cache?.set(element, background)
  return background
}
