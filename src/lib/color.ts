export type RGB = [number, number, number]

export type Oklch = {
  /** Lightness, 0 to 100. */
  l: number
  /** Chroma, 0 to about 0.4. */
  c: number
  /** Hue in degrees, 0 to 360. */
  h: number
}

type Triple = [number, number, number]

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360

const toLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear = (channel: number) =>
  255 *
  (channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055)

function linearToOklab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToOklch([lightness, a, b]: Triple): Oklch {
  const c = Math.sqrt(a * a + b * b)
  return {
    l: lightness * 100,
    c,
    h: c < 1e-4 ? 0 : wrapHue((Math.atan2(b, a) * 180) / Math.PI),
  }
}

function oklchToLinear([lightness, chroma, hue]: Triple): Triple {
  const angle = (hue * Math.PI) / 180
  const L = lightness / 100
  const a = chroma * Math.cos(angle)
  const b = chroma * Math.sin(angle)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inSrgb = (linear: Triple) =>
  linear.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4)

const clipLinear = (linear: Triple) =>
  linear.map((channel) => clamp(channel, 0, 1)) as Triple

function clipError(clipped: Triple, [lightness, chroma, hue]: Triple) {
  const [l, a, b] = linearToOklab(clipped)
  const angle = (hue * Math.PI) / 180
  return Math.hypot(
    l - lightness / 100,
    a - chroma * Math.cos(angle),
    b - chroma * Math.sin(angle),
  )
}

/**
 * OKLCH to sRGB, with CSS Color 4's gamut mapping. The same math the color
 * picker uses, kept free of the DOM so node tests can read it.
 */
export function oklchToRgb([lightness, chroma, hue]: Triple): RGB {
  const encode = (linear: Triple) =>
    linear.map((channel) => fromLinear(channel)) as Triple
  if (lightness >= 100) return [255, 255, 255]
  if (lightness <= 0) return [0, 0, 0]
  const target: Triple = [lightness, Math.max(0, chroma), hue]
  const origin = oklchToLinear(target)
  if (inSrgb(origin)) return encode(clipLinear(origin))
  let clipped = clipLinear(origin)
  if (clipError(clipped, target) < 0.02) return encode(clipped)
  let low = 0
  let high = target[1]
  let lowInGamut = true
  while (high - low > 1e-4) {
    const mid = (low + high) / 2
    const current: Triple = [lightness, mid, hue]
    const linear = oklchToLinear(current)
    if (lowInGamut && inSrgb(linear)) {
      low = mid
      continue
    }
    clipped = clipLinear(linear)
    const error = clipError(clipped, current)
    if (error < 0.02) {
      if (0.02 - error < 1e-4) break
      lowInGamut = false
      low = mid
    } else {
      high = mid
    }
  }
  return encode(clipped)
}

export function rgbToOklch(rgb: RGB): Oklch {
  return oklabToOklch(linearToOklab(rgb.map(toLinear) as Triple))
}

const HEX_PATTERN = /^#?([\da-f]{3}|[\da-f]{6})$/i

function hexToRgb(hex: string): RGB | null {
  const match = HEX_PATTERN.exec(hex.trim())
  if (!match) return null
  let digits = match[1]
  if (digits.length === 3) {
    digits = [...digits].map((digit) => digit + digit).join('')
  }
  return [0, 2, 4].map((index) =>
    parseInt(digits.slice(index, index + 2), 16),
  ) as RGB
}

export function hexToOklch(hex: string): Oklch {
  const rgb = hexToRgb(hex)
  if (!rgb) throw new Error(`Expected a hex color, received ${hex}`)
  return rgbToOklch(rgb)
}

const OKLCH_PATTERN =
  /^oklch\(\s*([+-]?(?:\d+\.?\d*|\.\d+))(%?)\s+([+-]?(?:\d+\.?\d*|\.\d+))(%?)\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:deg)?\s*\)$/i

function readOklch(value: string): Triple | null {
  const match = OKLCH_PATTERN.exec(value.trim())
  if (!match) return null
  const lightness = Number(match[1])
  const chroma = Number(match[3])
  const hue = Number(match[5])
  if (![lightness, chroma, hue].every(Number.isFinite)) return null
  return [
    match[2] ? lightness : lightness <= 1 ? lightness * 100 : lightness,
    match[4] ? (chroma * 0.4) / 100 : chroma,
    hue,
  ]
}

/** Resolves the CSS colors the registry and its tests use: hex and oklch(). */
export function cssColorToRgb(value: string): RGB | null {
  const hex = hexToRgb(value)
  if (hex) return hex
  const oklch = readOklch(value)
  return oklch ? oklchToRgb(oklch) : null
}

export function relativeLuminance([r, g, b]: RGB) {
  return [r, g, b]
    .map(toLinear)
    .reduce(
      (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    )
}

/** The WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(first: RGB, second: RGB) {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
