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

const viewOnly: RealtimeState = {
  status: 'connected',
  capabilities: { view: true, edit: false, comment: false },
  peers: 0,
}

it('shows only the highest permission icon in the trigger', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = container.querySelector('button')!
  expect(trigger.querySelector('.lucide-pencil')).not.toBeNull()
  expect(trigger.querySelector('.lucide-eye')).toBeNull()
})

it('shows an eye when the document is view only', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={true}
        realtime={viewOnly}
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = container.querySelector('button')!
  expect(trigger.querySelector('.lucide-eye')).not.toBeNull()
  expect(trigger.querySelector('.lucide-pencil')).toBeNull()
})

it('lists granted and denied permissions with colored indicators', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={true}
        realtime={viewOnly}
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  await act(async () => container.querySelector('button')!.click())
  const rows = document.body.querySelectorAll('[data-granted]')
  expect(rows).toHaveLength(3)
  expect(rows[0].textContent).toContain('You can view this file')
  expect(rows[0].getAttribute('data-granted')).toBe('true')
  expect(rows[0].querySelector('.text-emerald-600')).not.toBeNull()
  expect(rows[1].textContent).toContain("You can't edit this file")
  expect(rows[1].getAttribute('data-granted')).toBe('false')
  expect(rows[1].querySelector('.text-muted-foreground\\/50')).not.toBeNull()
  expect(rows[2].textContent).toContain("You can't comment on this file")
})

it('keeps the trigger compact when live collaboration is off', async () => {
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        liveCollaboration={false}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = container.querySelector('button')!
  expect(trigger.textContent).toBe('')
  expect(trigger.getAttribute('title')).toContain('Live collaboration off')
  expect(trigger.querySelector('.bg-amber-500')).not.toBeNull()
  expect(container.textContent).not.toContain('Live collaboration off')

  await act(async () => trigger.click())
  expect(document.body.textContent).toContain('Live collaboration off')
})

it('toggles the live collaboration kill switch from the menu', async () => {
  const onLiveCollaborationChange = vi.fn()
  await act(async () => {
    root.render(
      <DocumentAccessStatus
        readOnly={false}
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
