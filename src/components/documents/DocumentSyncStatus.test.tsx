import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DocumentSyncStatus as SyncStatus } from '#/lib/documents/storage'
import { DocumentSyncStatus } from './DocumentSyncStatus'
import { Doc } from 'yjs'
import { serializeConcept } from '#/lib/documents/serialization'

let root: Root
let container: HTMLDivElement
const docs: Array<Doc> = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  docs.splice(0).forEach((doc) => doc.destroy())
  container.remove()
  vi.unstubAllGlobals()
})
it.each([
  ['local', 'Stored in this browser', 'lucide-hard-drive'],
  ['pending', 'Waiting to save', 'lucide-cloud-upload'],
  ['syncing', 'Saving', 'lucide-loader-circle'],
  ['synced', 'Saved to Google Drive', 'lucide-cloud-check'],
  ['offline', 'Offline', 'lucide-cloud-off'],
  ['error', 'Could not sync', 'lucide-cloud-alert'],
] as const)(
  'shows the %s state with a distinct icon and opens details on click',
  async (state, label, iconClass) => {
    const status: SyncStatus = { state, message: 'Detailed storage status' }
    await act(() => root.render(<DocumentSyncStatus status={status} />))
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe(
      `Document sync status: ${label}`,
    )
    expect(button.querySelector('svg')?.classList.contains(iconClass)).toBe(
      true,
    )
    expect(button.querySelector('img')).toBeNull()
    expect(document.querySelector('[role="status"]')).toBeNull()
    await act(() => button.click())
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      status.message,
    )
  },
)
it('offers retry for a failed upload and updates to saved while the popover stays open', async () => {
  const retry = vi.fn()
  await act(() =>
    root.render(
      <DocumentSyncStatus
        status={{ state: 'error', message: 'Changes remain in this browser.' }}
        onRetry={retry}
      />,
    ),
  )
  await act(() => container.querySelector('button')!.click())
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === 'Retry sync',
  )!
  await act(() => button.click())
  expect(retry).toHaveBeenCalledOnce()
  await act(() =>
    root.render(
      <DocumentSyncStatus
        status={{ state: 'synced', message: 'Saved to Google Drive.' }}
        onRetry={retry}
      />,
    ),
  )
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    'Saved to Google Drive.',
  )
  expect(
    Array.from(document.querySelectorAll('button')).some(
      (item) => item.textContent === 'Retry sync',
    ),
  ).toBe(false)
})

it.each([false, true])(
  'shows storage and live exported file size (Drive: %s)',
  async (drive) => {
    const doc = new Doc()
    docs.push(doc)
    const documentRef = createRef<Doc>()
    documentRef.current = doc
    const info = {
      id: 'document',
      name: 'Résumé 🌎',
      updatedAt: 0,
      ...(drive
        ? {
            backing: {
              provider: 'google-drive',
              fileId: 'file',
              accountId: 'account',
            },
          }
        : {}),
    }
    await act(() =>
      root.render(
        <DocumentSyncStatus
          status={{
            state: drive ? 'synced' : 'local',
            message: drive
              ? 'Saved to Google Drive.'
              : 'Stored in this browser.',
          }}
          document={info}
          documentRef={documentRef}
        />,
      ),
    )
    expect(document.body.textContent).not.toContain('File size (.concept)')
    await act(() => container.querySelector('button')!.click())
    const bytes = new Blob([serializeConcept(info.name, doc)]).size
    expect(document.body.textContent).toContain('File size (.concept)')
    expect(document.body.textContent).toContain(
      drive ? 'Google Drive' : 'This browser',
    )
    expect(
      document.querySelector(`[title="${bytes.toLocaleString()} bytes"]`),
    ).not.toBeNull()
    expect(document.body.textContent).not.toContain('No account is required')
    if (drive)
      expect(
        document.querySelector('img[src="/icons/google-drive.svg"]'),
      ).not.toBeNull()
    else expect(document.querySelector('.lucide-monitor')).not.toBeNull()
    await act(() =>
      doc.getText('content').insert(0, 'More content 🌎'.repeat(1000)),
    )
    const updatedBytes = new Blob([serializeConcept(info.name, doc)]).size
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(
        document.querySelector(
          `[title="${updatedBytes.toLocaleString()} bytes"]`,
        )?.textContent,
      ).toContain('KB')
    })
  },
)
