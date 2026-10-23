import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentContextMenu } from './DocumentContextMenu'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode
    to: string
    params?: { id?: string }
  }) => (
    <a href={params?.id ? `/d/${params.id}` : to} {...props}>
      {children}
    </a>
  ),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function openContextMenu(target: HTMLElement) {
  return act(async () => {
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    )
  })
}

describe('DocumentContextMenu', () => {
  it('opens context menu actions, launches RenameDocumentDialog, and confirms local deletion', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const onDelete = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      root.render(
        <DocumentContextMenu
          id="doc-1"
          name="Project Spec"
          backedUp={false}
          onRename={onRename}
          onDelete={onDelete}
        >
          <span data-testid="row-target">Project Spec</span>
        </DocumentContextMenu>,
      )
    })

    const target = container.querySelector<HTMLElement>(
      '[data-testid="row-target"]',
    )!
    await openContextMenu(target)

    expect(document.body.textContent).toContain('Open in new tab')
    expect(document.body.textContent).toContain('Rename')
    expect(document.body.textContent).toContain('Delete document')

    // Click Rename item
    const renameItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent.includes('Rename'))!
    await act(async () => {
      renameItem.click()
    })

    expect(document.body.textContent).toContain('Rename document')
    const cancelRenameBtn = Array.from(
      document.querySelectorAll('button'),
    ).find((b) => b.textContent.trim() === 'Cancel')!
    await act(async () => {
      cancelRenameBtn.click()
    })

    // Re-open context menu and click Delete document
    await openContextMenu(target)
    const deleteItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent.includes('Delete document'))!
    await act(async () => {
      deleteItem.click()
    })

    expect(document.body.textContent).toContain(
      '“Project Spec” will be removed from your documents. Are you sure you want to delete it?',
    )

    const confirmBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Delete document',
    )!
    await act(async () => {
      confirmBtn.click()
    })
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('shows Google Drive retention message when backedUp is true', async () => {
    await act(async () => {
      root.render(
        <DocumentContextMenu
          id="doc-cloud"
          name="Synced Doc"
          backedUp={true}
          onDelete={vi.fn().mockResolvedValue(undefined)}
        >
          <span data-testid="cloud-target">Synced Doc</span>
        </DocumentContextMenu>,
      )
    })

    await openContextMenu(
      container.querySelector<HTMLElement>('[data-testid="cloud-target"]')!,
    )

    const deleteItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent.includes('Delete document'))!
    await act(async () => {
      deleteItem.click()
    })

    expect(document.body.textContent).toContain(
      '“Synced Doc” and any unsynced changes will be removed from this browser. The saved file remains in Google Drive.',
    )
  })
})
