export type RGB = [number, number, number]

export function contrastRatio(a: RGB, b: RGB) {
  const luminance = (color: RGB) =>
    color
      .map((channel) => {
        const value = channel / 255
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      )
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function readableColor(color: RGB, background: RGB): RGB {
  if (contrastRatio(color, background) >= 4.5) return color
  const black: RGB = [0, 0, 0]
  const white: RGB = [255, 255, 255]
  const destination =
    contrastRatio(black, background) > contrastRatio(white, background)
      ? black
      : white
  for (let amount = 0.01; amount <= 1.01; amount += 0.01) {
    const candidate = color.map((channel, index) =>
      Math.round(
        channel + (destination[index] - channel) * Math.min(amount, 1),
      ),
    ) as RGB
    if (contrastRatio(candidate, background) >= 4.5) return candidate
  }
  return destination
}

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
