import { pageDimensions } from '#/lib/documents/page-setup'
import type { PageSetup } from '#/lib/documents/page-setup'

/** CSS reference pixel: 96 px per inch, 25.4 mm per inch. */
export const CSS_PX_PER_MM = 96 / 25.4

export const PAGELESS_CONTENT_PADDING = '2rem clamp(1.5rem, 6vw, 4rem)'
export const PAGELESS_PLACEHOLDER_TOP = '2rem'
export const PAGELESS_PLACEHOLDER_LEFT = 'clamp(1.5rem, 6vw, 4rem)'
export const PAGELESS_MAX_WIDTH = '960px'

export function mmToPx(mm: number) {
  return mm * CSS_PX_PER_MM
}

/** Formats a CSS px length without needless precision. */
export function formatPx(px: number) {
  return `${Number(px.toFixed(4))}px`
}

export type PageBoxPx = {
  width: number
  height: number
  margins: { top: number; right: number; bottom: number; left: number }
}

/** Converts the millimeter page model into the CSS px box used on screen. */
export function pageBoxPx(setup: PageSetup): PageBoxPx {
  const { width, height } = pageDimensions(setup)
  return {
    width: mmToPx(width),
    height: mmToPx(height),
    margins: {
      top: mmToPx(setup.margins.top),
      right: mmToPx(setup.margins.right),
      bottom: mmToPx(setup.margins.bottom),
      left: mmToPx(setup.margins.left),
    },
  }
}

/**
 * Applies the shared screen layout contract for a page setup.
 *
 * The sheet owns the page-mode flag and the content padding variable; the
 * editor root inherits both. In paper mode the sheet stops being a card and
 * shrinks to the page width (or the viewport, whichever is narrower) so the
 * pagination extension can zoom the pages to fit. In pageless mode the sheet
 * keeps the existing continuous-canvas look.
 */
export function applyPageLayout(sheet: HTMLElement, setup: PageSetup) {
  const paper = setup.mode === 'paper'
  const box = pageBoxPx(setup)
  sheet.dataset.pageMode = setup.mode

  if (paper) {
    sheet.style.width = `min(100%, ${formatPx(box.width)})`
    sheet.style.maxWidth = 'none'
    sheet.style.minHeight = '100%'
    sheet.style.setProperty('--page-width', formatPx(box.width))
    sheet.style.setProperty('--page-height', formatPx(box.height))
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      sheet.style.setProperty(
        `--page-margin-${side}`,
        formatPx(box.margins[side]),
      )
    }
    sheet.style.setProperty('--document-content-padding', '0px')
    sheet.style.setProperty(
      '--document-placeholder-top',
      'var(--page-margin-top)',
    )
    sheet.style.setProperty(
      '--document-placeholder-left',
      'calc(50% - var(--page-width) / 2 + var(--page-margin-left))',
    )
    return
  }

  sheet.style.width = '100%'
  sheet.style.maxWidth = PAGELESS_MAX_WIDTH
  sheet.style.minHeight = '100%'
  sheet.style.removeProperty('--page-width')
  sheet.style.removeProperty('--page-height')
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    sheet.style.setProperty(
      `--page-margin-${side}`,
      side === 'top' || side === 'bottom'
        ? PAGELESS_PLACEHOLDER_TOP
        : PAGELESS_PLACEHOLDER_LEFT,
    )
  }
  sheet.style.setProperty(
    '--document-content-padding',
    PAGELESS_CONTENT_PADDING,
  )
  sheet.style.setProperty(
    '--document-placeholder-top',
    PAGELESS_PLACEHOLDER_TOP,
  )
  sheet.style.setProperty(
    '--document-placeholder-left',
    PAGELESS_PLACEHOLDER_LEFT,
  )
}
