import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { DocumentContextMenu } from './DocumentContextMenu'
import { DocumentList } from './DocumentList'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
})

it('renders stable, accessible placeholders before hydration', () => {
  const render = () =>
    renderToString(
      <DocumentList
        documents={[]}
        loading
        loadingLabel="Searching documents…"
        onDelete={vi.fn()}
      />,
    )
  const markup = render()
  expect(render()).toBe(markup)
  const holder = document.createElement('div')
  holder.innerHTML = markup
  expect(holder.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(holder.querySelector('[role="status"]')?.textContent).toBe(
    'Searching documents…',
  )
  expect(holder.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(5)
  expect(holder.querySelector('a, button')).toBeNull()
})

it('shows an empty search result only after loading completes', () => {
  const props = {
    documents: [],
    emptyMessage: 'No matching documents',
    onDelete: vi.fn(),
  }
  expect(renderToString(<DocumentList {...props} loading />)).not.toContain(
    props.emptyMessage,
  )
  const markup = renderToString(<DocumentList {...props} />)
  expect(markup).toContain(props.emptyMessage)
  expect(markup).toContain('aria-busy="false"')
  expect(markup).not.toContain('data-slot="skeleton"')
})

it('closes the rename dialog and unmounts cleanly without post-unmount state updates', async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onRename = vi.fn().mockResolvedValue(true)
  const onDelete = vi.fn().mockResolvedValue(undefined)
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  function Harness() {
    const [mounted, setMounted] = useState(true)
    return mounted ? (
      <DocumentContextMenu
        id="doc-1"
        name="Original"
        onRename={onRename}
        onDelete={async () => {
          await onDelete()
          setMounted(false)
        }}
      >
        <button type="button">Row</button>
      </DocumentContextMenu>
    ) : null
  }

  await act(async () => root!.render(<Harness />))
  const trigger = container.querySelector('button')!
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    )
  })
  const renameItem = Array.from(
    document.querySelectorAll('[role="menuitem"]'),
  ).find((item) => item.textContent.includes('Rename')) as HTMLElement
  expect(renameItem).toBeDefined()
  await act(async () => renameItem.click())

  const input = document.querySelector<HTMLInputElement>('input')!
  expect(input.value).toBe('Original')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, 'Renamed')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const form = document.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(onRename).toHaveBeenCalledWith('Renamed')
  expect(document.querySelector('form')).toBeNull()

  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    )
  })
  const deleteItem = Array.from(
    document.querySelectorAll('[role="menuitem"]'),
  ).find((item) => item.textContent.includes('Delete document')) as HTMLElement
  expect(deleteItem).toBeDefined()
  await act(async () => deleteItem.click())

  const confirmButton = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === 'Delete document',
  )!
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    confirmButton.dispatchEvent(clickEvent)
  })
  expect(clickEvent.defaultPrevented).toBe(true)
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})
