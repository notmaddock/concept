import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { RealtimeState } from '#/lib/documents/realtime/realtime'
import { DocumentAccessStatus } from './DocumentAccessStatus'

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

const connected: RealtimeState = {
  status: 'connected',
  capabilities: { view: true, edit: true, comment: false },
  peers: 2,
}

it('shows separate view and edit indicators when connected', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        provider="google-drive"
        realtime={connected}
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = container.querySelector('button')!
  expect(trigger.querySelector('.lucide-eye')).not.toBeNull()
  expect(trigger.querySelector('.lucide-pencil')).not.toBeNull()
})

it('expands the view indicator into a pill when live collaboration is off', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        provider="google-drive"
        realtime={connected}
        liveCollaboration={false}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  expect(container.textContent).toContain('Live collaboration off')
})

it('toggles the live collaboration kill switch from the menu', async () => {
  const onLiveCollaborationChange = vi.fn()
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        provider="google-drive"
        realtime={connected}
        liveCollaboration={true}
        onLiveCollaborationChange={onLiveCollaborationChange}
      />,
    )
  })
  await act(async () => container.querySelector('button')!.click())
  const checkbox = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="checkbox"]',
  )!
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  expect(document.body.textContent).toContain('Live collaboration')
  expect(document.body.textContent).toContain('Connected')
  await act(async () => checkbox.click())
  expect(onLiveCollaborationChange).toHaveBeenCalledWith(false)
})
