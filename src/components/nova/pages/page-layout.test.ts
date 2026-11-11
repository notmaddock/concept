import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SETUP } from '#/lib/documents/page-setup'
import type { PageSetup } from '#/lib/documents/page-setup'
import {
  applyPageLayout,
  formatPx,
  mmToPx,
  pageBoxPx,
  PAGELESS_CONTENT_PADDING,
} from './page-layout'

const paper = (overrides: Partial<PageSetup> = {}): PageSetup => ({
  ...DEFAULT_PAGE_SETUP,
  mode: 'paper',
  ...overrides,
})

describe('mmToPx', () => {
  it('uses the 96 dpi CSS reference pixel', () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 10)
    expect(mmToPx(210)).toBeCloseTo(793.7008, 4)
  })

  it('formats lengths without trailing noise', () => {
    expect(formatPx(96)).toBe('96px')
    expect(formatPx(mmToPx(210))).toBe('793.7008px')
  })
})

describe('pageBoxPx', () => {
  it('converts portrait A4 dimensions and margins', () => {
    const box = pageBoxPx(paper())
    expect(box.width).toBeCloseTo(793.7008, 4)
    expect(box.height).toBeCloseTo(1122.5197, 4)
    expect(box.margins.top).toBeCloseTo(96, 4)
    expect(box.margins.left).toBeCloseTo(96, 4)
  })

  it('swaps dimensions for landscape and honours custom sizes', () => {
    const landscape = pageBoxPx(paper({ orientation: 'landscape' }))
    expect(landscape.width).toBeCloseTo(1122.5197, 4)
    expect(landscape.height).toBeCloseTo(793.7008, 4)

    const custom = pageBoxPx(paper({ size: 'custom', width: 100, height: 200 }))
    expect(custom.width).toBeCloseTo(377.9528, 4)
    expect(custom.height).toBeCloseTo(755.9055, 4)
  })
})

describe('applyPageLayout', () => {
  it('turns the sheet into a transparent page host in paper mode', () => {
    const sheet = document.createElement('div')
    applyPageLayout(sheet, paper())

    expect(sheet.dataset.pageMode).toBe('paper')
    expect(sheet.style.width).toBe('min(100%, 793.7008px)')
    expect(sheet.style.maxWidth).toBe('none')
    expect(sheet.style.minHeight).toBe('100%')
    expect(sheet.style.getPropertyValue('--page-width')).toBe('793.7008px')
    expect(sheet.style.getPropertyValue('--page-height')).toBe('1122.5197px')
    expect(sheet.style.getPropertyValue('--page-margin-top')).toBe('96px')
    expect(sheet.style.getPropertyValue('--document-content-padding')).toBe(
      '0px',
    )
  })

  it('restores the continuous canvas in pageless mode', () => {
    const sheet = document.createElement('div')
    applyPageLayout(sheet, paper())
    applyPageLayout(sheet, { ...DEFAULT_PAGE_SETUP, mode: 'pageless' })

    expect(sheet.dataset.pageMode).toBe('pageless')
    expect(sheet.style.width).toBe('100%')
    expect(sheet.style.maxWidth).toBe('960px')
    expect(sheet.style.getPropertyValue('--page-width')).toBe('')
    expect(sheet.style.getPropertyValue('--page-height')).toBe('')
    expect(sheet.style.getPropertyValue('--document-content-padding')).toBe(
      PAGELESS_CONTENT_PADDING,
    )
  })
})
