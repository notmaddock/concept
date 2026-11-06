import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { SaveStatus } from '#/lib/documents/sync'
import { DocumentSaveStatus } from './DocumentSaveStatus'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each<[SaveStatus['phase'], boolean, string]>([
  ['local', false, 'All changes saved locally'],
  ['synced', false, 'All changes saved to Drive'],
  ['pending', true, 'Waiting to save'],
  ['saving', true, 'Saving to Drive'],
  ['reconciling', true, 'Reconciling external changes'],
  ['offline', true, 'Offline'],
  ['auth-required', true, 'Reconnect Google Drive'],
])(
  'announces %s and expands only when useful',
  async (phase, expanded, label) => {
    await act(async () => {
      root.render(
        <DocumentSaveStatus status={{ phase }} provider="google-drive" />,
      )
    })
    const trigger = container.querySelector('button')!
    expect(trigger.getAttribute('aria-label')).toBe(label)
    expect(trigger.dataset.expanded).toBe(String(expanded))
    expect(
      trigger.querySelector('.document-save-status-label')?.textContent,
    ).toBe(label)
  },
)

it('identifies a local save destination', async () => {
  await act(async () => {
    root.render(<DocumentSaveStatus status={{ phase: 'saving' }} />)
  })
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Saving to this device',
  )
})

it('uses a controlled offline toggle and exposes the containing folder action', async () => {
  const onOfflineChange = vi.fn()
  const onOpenContainingFolder = vi.fn()
  const renderStatus = async (offlineAvailable: boolean) => {
    await act(async () => {
      root.render(
        <DocumentSaveStatus
          status={{ phase: 'synced', offlineAvailable }}
          provider="google-drive"
          onOfflineChange={onOfflineChange}
          onOpenContainingFolder={onOpenContainingFolder}
        />,
      )
    })
  }
  await renderStatus(false)
  await act(async () => container.querySelector('button')!.click())
  const toggle = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="toggle"]',
  )!
  expect(toggle.textContent).toBe('Available offline')
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  await act(async () => toggle.click())
  expect(onOfflineChange).toHaveBeenCalledWith(true, expect.anything())
  await renderStatus(true)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  await act(async () => toggle.click())
  expect(onOfflineChange).toHaveBeenLastCalledWith(false, expect.anything())
  const folder = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent === 'Open containing folder',
  )!
  await act(async () => folder.click())
  expect(onOpenContainingFolder).toHaveBeenCalledOnce()
})
