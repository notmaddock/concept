import { act } from 'react'
import { expect, it, vi } from 'vitest'
import type { SaveStatus } from '#/lib/documents/sync'
import { DocumentSaveStatus } from './DocumentSaveStatus'
import { setupTestRoot } from '#/test/react-test'

const harness = setupTestRoot()

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
      harness.root.render(
        <DocumentSaveStatus status={{ phase }} provider="google-drive" />,
      )
    })
    const trigger = harness.container.querySelector('button')!
    expect(trigger.getAttribute('aria-label')).toBe(label)
    expect(trigger.dataset.expanded).toBe(String(expanded))
    expect(
      trigger.querySelector('.document-save-status-label')?.textContent,
    ).toBe(label)
  },
)

it('identifies a local save destination', async () => {
  await act(async () => {
    harness.root.render(<DocumentSaveStatus status={{ phase: 'saving' }} />)
  })
  expect(
    harness.container.querySelector('button')?.getAttribute('aria-label'),
  ).toBe('Saving to this device')
})

it('uses a controlled offline switch and exposes the containing folder action', async () => {
  const onOfflineChange = vi.fn()
  const onOpenContainingFolder = vi.fn()
  const renderStatus = async (offlineAvailable: boolean) => {
    await act(async () => {
      harness.root.render(
        <DocumentSaveStatus
          status={{ phase: 'synced', offlineAvailable }}
          provider="google-drive"
          onOfflineChange={onOfflineChange}
          onOpenContainingFolder={onOpenContainingFolder}
        />,
      )
    })
  }
  const getSwitch = () =>
    document.body.querySelector<HTMLElement>('[role="switch"]')!
  await renderStatus(false)
  await act(async () => harness.container.querySelector('button')!.click())
  expect(getSwitch().getAttribute('aria-checked')).toBe('false')
  const label = getSwitch().closest('label')!
  expect(label.textContent).toContain('Available offline')
  await act(async () => label.click())
  expect(onOfflineChange).toHaveBeenCalledWith(true)
  await renderStatus(true)
  expect(getSwitch().getAttribute('aria-checked')).toBe('true')
  await act(async () => getSwitch().click())
  expect(onOfflineChange).toHaveBeenCalledWith(false)
  expect(onOfflineChange).toHaveBeenCalledTimes(2)
  const folder = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent === 'Open containing folder',
  )!
  await act(async () => folder.click())
  expect(onOpenContainingFolder).toHaveBeenCalledOnce()
})
