import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DocumentActionSearch } from './DocumentActionSearch'

vi.mock('./document-workspace-context', () => ({
  useDocumentWorkspace: () => ({ enabled: false, focusEditor: vi.fn() }),
}))

it('allows opening action search without an open document', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(() => root.render(<DocumentActionSearch options={[]} />))
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Search menus and actions"]',
    )!
    expect(trigger.disabled).toBe(false)
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
      )
    })
    expect(
      container.querySelector('input[aria-label="Search menus and actions"]'),
    ).not.toBeNull()
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
