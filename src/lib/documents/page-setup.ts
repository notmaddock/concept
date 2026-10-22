import { $getRoot, $getState, $setState, createState } from 'lexical'

// Dimensions and margins use millimeters, independent of display units.
export const PAGE_SIZES = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  B4: [250, 353],
  B5: [176, 250],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
  Executive: [184.15, 266.7],
  Folio: [215.9, 330.2],
  Statement: [139.7, 215.9],
} as const
export type PageSetup = {
  mode: 'pageless' | 'paper'
  size: keyof typeof PAGE_SIZES | 'custom'
  orientation: 'portrait' | 'landscape'
  width: number
  height: number
  margins: { top: number; right: number; bottom: number; left: number }
}
export const DEFAULT_PAGE_SETUP: PageSetup = {
  mode: 'pageless',
  size: 'A4',
  orientation: 'portrait',
  width: 210,
  height: 297,
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
}
export function pageDimensions(setup: PageSetup) {
  const [width, height] =
    setup.size === 'custom'
      ? [setup.width, setup.height]
      : PAGE_SIZES[setup.size]
  return setup.orientation === 'portrait'
    ? { width, height }
    : { width: height, height: width }
}
export function pageSetupError(setup: PageSetup): string | null {
  if (setup.mode === 'pageless') return null
  const { width, height } = pageDimensions(setup)
  if (![width, height].every((v) => Number.isFinite(v) && v >= 50 && v <= 2000))
    return 'Paper dimensions must be between 50 and 2,000 mm.'
  if (!Object.values(setup.margins).every((v) => Number.isFinite(v) && v >= 0))
    return 'Margins must be zero or greater.'
  if (
    setup.margins.left + setup.margins.right >= width - 10 ||
    setup.margins.top + setup.margins.bottom >= height - 10
  )
    return 'Leave at least 10 mm of writing space between margins.'
  return null
}
export const pageSetupState = createState('pageSetup', {
  parse(value: unknown): PageSetup {
    if (!value || typeof value !== 'object') return DEFAULT_PAGE_SETUP
    const v = value as Partial<PageSetup>
    const setup: PageSetup = {
      mode: v.mode === 'paper' ? 'paper' : 'pageless',
      size:
        v.size && (v.size === 'custom' || Object.hasOwn(PAGE_SIZES, v.size))
          ? v.size
          : 'A4',
      orientation: v.orientation === 'landscape' ? 'landscape' : 'portrait',
      width: typeof v.width === 'number' ? v.width : 210,
      height: typeof v.height === 'number' ? v.height : 297,
      margins: Object.fromEntries(
        Object.entries(DEFAULT_PAGE_SETUP.margins).map(([key, fallback]) => [
          key,
          typeof v.margins?.[key as keyof PageSetup['margins']] === 'number'
            ? v.margins[key as keyof PageSetup['margins']]
            : fallback,
        ]),
      ) as PageSetup['margins'],
    }
    return pageSetupError({ ...setup, mode: 'paper' })
      ? DEFAULT_PAGE_SETUP
      : setup
  },
})
export function $getPageSetup() {
  return $getState($getRoot(), pageSetupState)
}
export function $setPageSetup(setup: PageSetup) {
  $setState($getRoot(), pageSetupState, setup)
}
