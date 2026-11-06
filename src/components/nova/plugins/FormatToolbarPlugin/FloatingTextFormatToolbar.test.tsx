import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { expect, it, vi } from 'vitest'
import { FloatingTextFormatToolbar } from './FloatingTextFormatToolbar'

vi.mock('#/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('#/components/documents/navigation-menus/use-format-actions', () => ({
  useFormatActions: () => ({ run: vi.fn(), checked: () => false }),
}))
vi.mock('./TypographyControls', () => ({
  TypographyControls: () => null,
  FormatIcon: ({ label }: { label: string }) => <button>{label}</button>,
}))
vi.mock('./FormatOptions', () => ({
  FormatSelect: () => null,
  toolbarActions: [],
}))
vi.mock('./ColorSelect', () => ({ ColorSelect: () => null }))

it('docks formatting above the keyboard and follows the visible viewport', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const viewport = Object.assign(new EventTarget(), {
    height: 400,
    width: 375,
    offsetTop: 20,
    offsetLeft: 0,
  })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(() =>
      root.render(
        <FloatingTextFormatToolbar
          editor={createEditor()}
          isOpen
          rangeRect={{ top: 20, left: 10, width: 100, height: 20 }}
          formatState={{
            isBold: false,
            isItalic: false,
            isUnderline: false,
            isStrikethrough: false,
            isCode: false,
            isSubscript: false,
            isSuperscript: false,
          }}
          onOpenChange={vi.fn()}
        />,
      ),
    )
    const toolbar = document.querySelector<HTMLElement>('[data-mobile="true"]')!
    expect(toolbar.style.bottom).toBe('380px')
    expect(toolbar.style.width).toBe('375px')
    viewport.height = 500
    viewport.offsetTop = 0
    await act(() => viewport.dispatchEvent(new Event('resize')))
    expect(toolbar.style.bottom).toBe('300px')
    expect(toolbar.querySelector('button')?.textContent).toBe('Bold')
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
