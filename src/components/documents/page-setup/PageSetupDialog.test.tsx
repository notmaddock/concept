import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PAGE_SETUP, PAGE_SIZES } from '#/lib/documents/page-setup'
import { PageSetupDialog } from './PageSetupDialog'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each(Object.keys(PAGE_SIZES) as Array<keyof typeof PAGE_SIZES>)(
  'submits %s in every display unit without changing millimeter precision',
  async (size) => {
    for (const margin of [12.7, 25.4, 38.1, 50.8]) {
      // The widest preset leaves insufficient writing space on A6.
      if (size === 'A6' && margin === 50.8) continue
      const value = {
        ...DEFAULT_PAGE_SETUP,
        mode: 'paper' as const,
        size,
        margins: { top: margin, right: margin, bottom: margin, left: margin },
      }
      const apply = vi.fn()
      await act(() =>
        root.render(
          <PageSetupDialog
            key={`${size}-${margin}`}
            open
            onOpenChange={() => {}}
            value={value}
            onApply={apply}
          />,
        ),
      )
      for (const unit of ['Millimeters', 'Centimeters', 'Inches']) {
        const button = Array.from(document.querySelectorAll('button')).find(
          (element) => element.textContent === unit,
        )!
        await act(() => button.click())
        const form = document.querySelector('form')!
        expect(form.checkValidity()).toBe(true)
        await act(() => form.requestSubmit())
        expect(apply).toHaveBeenLastCalledWith(value)
      }
    }
  },
  15_000,
)

it('accepts converted custom dimensions and preserves their internal values', async () => {
  const value = {
    ...DEFAULT_PAGE_SETUP,
    mode: 'paper' as const,
    size: 'custom' as const,
    width: 210.123456,
    height: 297.654321,
  }
  const apply = vi.fn()
  await act(() =>
    root.render(
      <PageSetupDialog
        open
        onOpenChange={() => {}}
        value={value}
        onApply={apply}
      />,
    ),
  )
  for (const unit of ['Inches', 'Centimeters', 'Millimeters']) {
    await act(() =>
      Array.from(document.querySelectorAll('button'))
        .find((element) => element.textContent === unit)!
        .click(),
    )
    const form = document.querySelector('form')!
    expect(form.checkValidity()).toBe(true)
    await act(() => form.requestSubmit())
    expect(apply).toHaveBeenLastCalledWith(value)
  }
})
