import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { DocumentContextMenu } from './DocumentContextMenu'
import { setDocumentOfflineAvailable } from '#/lib/documents/document-storage'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}))
vi.mock('#/lib/documents/document-storage', () => ({
  setDocumentOfflineAvailable: vi.fn(async () => {}),
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

async function openMenu(drive = true, offlineAvailable = true) {
  await act(() =>
    root.render(
      <DocumentContextMenu
        id="Gfile"
        name="Example"
        driveFileId={drive ? 'file' : undefined}
        offlineAvailable={offlineAvailable}
        onDelete={async () => {}}
      >
        <span>Document</span>
      </DocumentContextMenu>,
    ),
  )
  await act(() =>
    container
      .querySelector('[data-slot="context-menu-trigger"]')!
      .dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
  )
}

it('shows a checked offline menu item and toggles that document', async () => {
  await openMenu()
  const checkbox = document.querySelector<HTMLElement>(
    '[role="menuitemcheckbox"]',
  )!
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  expect(checkbox.textContent).toBe(' Available offline')
  expect(checkbox.querySelector('svg')).not.toBeNull()
  expect(document.body.textContent).toContain('Open containing folder')
  await act(() => checkbox.click())
  expect(setDocumentOfflineAvailable).toHaveBeenCalledWith('Gfile', false)
})

it('omits Drive actions for local documents', async () => {
  await openMenu(false)
  expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull()
  expect(document.body.textContent).not.toContain('Open containing folder')
})

it('shows an unchecked item when offline availability is off', async () => {
  await openMenu(true, false)
  expect(
    document
      .querySelector('[role="menuitemcheckbox"]')
      ?.getAttribute('aria-checked'),
  ).toBe('false')
})
