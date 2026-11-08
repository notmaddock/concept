import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentProps, ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DocumentList } from './DocumentList'
import { useDocumentListWindow } from './use-document-list-window'
import type { DocumentListWindow } from './use-document-list-window'

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
  vi.useFakeTimers()
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
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
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
    vi.advanceTimersByTime(10)
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
    vi.advanceTimersByTime(10)
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
    vi.advanceTimersByTime(10)
  })
  expect(document.activeElement?.textContent).toBe('Document 998')
  await act(async () => {
    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(10)
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

it('marks only offline-available Drive documents with the offline icon', async () => {
  const items = [
    { id: 'local', name: 'Local', updatedAt: 1 },
    {
      id: 'Gonline',
      name: 'Online Drive',
      updatedAt: 1,
      drive: { fileId: 'online', offlineAvailable: false },
    },
    {
      id: 'Goffline',
      name: 'Offline Drive',
      updatedAt: 1,
      drive: { fileId: 'offline', offlineAvailable: true },
    },
  ]
  await act(() =>
    root.render(<DocumentList documents={items} onDelete={vi.fn()} />),
  )
  const indicators = container.querySelectorAll(
    '[aria-label="Available offline"]',
  )
  expect(indicators).toHaveLength(1)
  expect(indicators[0].closest('li')?.textContent).toContain('Offline Drive')
  expect(
    indicators[0].querySelector('.lucide-hard-drive-download'),
  ).not.toBeNull()
  expect(indicators[0].getAttribute('title')).toBe('Available offline')
  items[2].drive!.offlineAvailable = false
  await act(() =>
    root.render(<DocumentList documents={[...items]} onDelete={vi.fn()} />),
  )
  expect(container.querySelector('[aria-label="Available offline"]')).toBeNull()
})

it('does not intercept Tab key so standard keyboard navigation can exit the list', async () => {
  const list = await render()
  const first = list.querySelector('a')!
  await act(() => first.focus())
  const tabEvent = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  })
  first.dispatchEvent(tabEvent)
  expect(tabEvent.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(first)
})

it('allows reveal() when count is below virtualization threshold', async () => {
  const shortDocs = Array.from({ length: 40 }, (_, index) => ({
    id: `short-${index}`,
    name: `Short Document ${index}`,
    updatedAt: index,
  }))
  await act(() =>
    root.render(
      <DocumentList
        documents={shortDocs}
        activeId="short-35"
        onDelete={vi.fn()}
      />,
    ),
  )
  const list = container.querySelector('ul')!
  list.getBoundingClientRect = () => ({ top: -container.scrollTop }) as DOMRect
  expect(container.scrollTop).toBeGreaterThan(0)
  expect(list.querySelector('[data-document-index="35"]')).not.toBeNull()
})

it('prevents negative index injection in useDocumentListWindow', async () => {
  let listWindow!: DocumentListWindow
  function Probe() {
    listWindow = useDocumentListWindow(100, 0)
    return <ul ref={listWindow.listRef} />
  }
  await act(() => root.render(<Probe />))
  await act(() => {
    listWindow.setFocusedIndex(-1)
  })
  expect(listWindow.indexes).not.toContain(-1)
  expect(listWindow.indexes.every((index) => index >= 0)).toBe(true)
  await act(() => {
    listWindow.focus(-1)
  })
  expect(listWindow.indexes).not.toContain(-1)
  expect(listWindow.indexes.every((index) => index >= 0)).toBe(true)
})
