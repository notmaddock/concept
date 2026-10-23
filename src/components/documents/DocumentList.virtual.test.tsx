import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentProps, ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DocumentList } from './DocumentList'

vi.mock('@tanstack/react-router', () => ({ Link: () => null }))
vi.mock('./DocumentContextMenu', () => ({
  DocumentContextMenu: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('./DocumentDetailsPopover', () => ({
  DocumentDetailsPopover: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('#/components/ui/sidebar', () => ({
  SidebarMenu: (props: ComponentProps<'ul'>) => <ul {...props} />,
  SidebarMenuItem: (props: ComponentProps<'li'>) => <li {...props} />,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => (
    <a href="#document">{children}</a>
  ),
}))

let root: Root
let container: HTMLDivElement
const documents = Array.from({ length: 1000 }, (_, index) => ({
  id: `doc-${index}`,
  name: `Document ${index}`,
  updatedAt: index,
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  container = document.createElement('div')
  container.dataset.sidebar = 'content'
  Object.defineProperty(container, 'clientHeight', { value: 340 })
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(activeId?: string) {
  await act(() =>
    root.render(
      <DocumentList
        documents={documents}
        activeId={activeId}
        onDelete={vi.fn()}
      />,
    ),
  )
  const list = container.querySelector('ul')!
  list.getBoundingClientRect = () => ({ top: -container.scrollTop }) as DOMRect
  return list
}

it('bounds mounted rows while preserving list positions and scroll extent', async () => {
  const list = await render()
  expect(list.querySelectorAll('li').length).toBeLessThan(30)
  expect(list.style.height).toBe('33998px')
  expect(list.querySelector('li')?.getAttribute('aria-setsize')).toBe('1000')
  await act(async () => {
    container.scrollTop = 17000
    container.dispatchEvent(new Event('scroll'))
    await vi.runOnlyPendingTimersAsync()
  })
  expect(list.textContent).toContain('Document 500')
  expect(list.textContent).not.toContain('Document 0')
  expect(list.querySelectorAll('li').length).toBeLessThan(30)
})

it('reveals an active document outside the initial viewport', async () => {
  const list = await render('doc-900')
  expect(container.scrollTop).toBeGreaterThan(30000)
  expect(list.querySelector('[data-document-index="900"]')).not.toBeNull()
})

it('supports keyboard traversal across virtual windows and keeps focused rows mounted', async () => {
  const list = await render()
  const first = list.querySelector('a')!
  await act(() => first.focus())
  await act(async () => {
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }),
    )
    await vi.runOnlyPendingTimersAsync()
  })
  expect(document.activeElement?.textContent).toBe('Document 999')
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    await vi.runOnlyPendingTimersAsync()
  })
  expect(document.activeElement?.textContent).toBe('Document 998')
  await act(async () => {
    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    await vi.runOnlyPendingTimersAsync()
  })
  expect(document.activeElement?.textContent).toBe('Document 998')
  expect(list.querySelectorAll('li').length).toBeLessThan(30)
})

it('focuses newly mounted rows during commit without waiting for a frame', async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  const list = await render()
  const first = list.querySelector('a')!
  await act(() => first.focus())
  await act(() => {
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  expect(document.activeElement?.textContent).toBe('Document 999')
})

it('allows Tab to navigate out of the document list without intercepting it', async () => {
  const list = await render()
  const first = list.querySelector('a')!
  await act(() => first.focus())
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  })
  first.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})
