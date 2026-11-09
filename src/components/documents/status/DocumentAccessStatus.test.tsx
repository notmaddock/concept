import { act } from 'react'
import { expect, it, vi } from 'vitest'
import type { RealtimeState } from '#/lib/documents/realtime/realtime'
import { DocumentAccessStatus } from './DocumentAccessStatus'
import { setupTestRoot } from '#/test/react-test'

const harness = setupTestRoot()

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
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.querySelector('.lucide-pencil')).not.toBeNull()
  expect(trigger.querySelector('.lucide-eye')).toBeNull()
})

it('shows an eye when the document is view only', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={true}
        realtime={viewOnly}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.querySelector('.lucide-eye')).not.toBeNull()
  expect(trigger.querySelector('.lucide-pencil')).toBeNull()
})

it('lists granted and denied permissions with colored indicators', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={true}
        realtime={viewOnly}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  await act(async () => harness.container.querySelector('button')!.click())
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
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        storageName="Google Drive"
        liveCollaboration={false}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.dataset.expanded).toBe('false')
  expect(
    trigger.querySelector('.document-access-status-label')?.textContent,
  ).toBe('')
  expect(trigger.getAttribute('title')).toContain('Live collaboration off')
  expect(trigger.querySelector('.bg-amber-500')).not.toBeNull()
  expect(harness.container.textContent).not.toContain('Live collaboration off')

  await act(async () => trigger.click())
  expect(document.body.textContent).toContain('Live collaboration off')
  expect(document.body.textContent).toContain(
    'Changes still sync through Google Drive',
  )
})

it('names the backing storage in the collaboration notice', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        storageName="Acme Cloud"
        liveCollaboration={false}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  await act(async () => harness.container.querySelector('button')!.click())
  expect(document.body.textContent).toContain(
    'Changes still sync through Acme Cloud',
  )
  expect(document.body.textContent).not.toContain('Google Drive')
})

it('hides live collaboration controls when the storage cannot collaborate', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        liveCollaboration={false}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.querySelector('.bg-amber-500')).toBeNull()
  expect(trigger.getAttribute('title')).toBe('Can edit')

  await act(async () => trigger.click())
  expect(document.body.textContent).not.toContain('Live collaboration')
  expect(document.body.querySelector('[data-slot="switch"]')).toBeNull()
})

it('expands into a view-only pill', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={true}
        realtime={viewOnly}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.dataset.expanded).toBe('true')
  expect(
    trigger.querySelector('.document-access-status-label')?.textContent,
  ).toBe('View only')
})

it.each([
  [1, '1 collaborator'],
  [2, '2 collaborators'],
])('summarizes %i other collaborators in the pill', async (others, label) => {
  const collaborators = [
    {
      clientID: 1,
      self: true,
      name: 'Ada Lovelace',
      color: 'rgb(1, 2, 3)',
      focusing: true,
    },
    ...Array.from({ length: others }, (_, index) => ({
      clientID: index + 2,
      self: false,
      name: `Guest ${index + 1}`,
      color: 'rgb(4, 5, 6)',
      focusing: false,
    })),
  ]
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={{ ...connected, collaborators }}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  const trigger = harness.container.querySelector('button')!
  expect(trigger.dataset.expanded).toBe('true')
  expect(
    trigger.querySelector('.document-access-status-label')?.textContent,
  ).toBe(label)
})

it('stays compact when the user is alone', async () => {
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={{
          ...connected,
          collaborators: [
            {
              clientID: 1,
              self: true,
              name: 'Ada Lovelace',
              focusing: true,
            },
          ],
        }}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  expect(harness.container.querySelector('button')!.dataset.expanded).toBe(
    'false',
  )
})

it('lists connected collaborators with names and activity stats', async () => {
  const withCollaborators: RealtimeState = {
    ...connected,
    collaborators: [
      {
        clientID: 1,
        self: true,
        name: 'Ada Lovelace',
        color: 'rgb(1, 2, 3)',
        focusing: true,
      },
      {
        clientID: 2,
        self: false,
        name: 'Grace Hopper',
        color: 'rgb(4, 5, 6)',
        focusing: false,
      },
    ],
  }
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={withCollaborators}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
      />,
    )
  })
  await act(async () => harness.container.querySelector('button')!.click())
  const text = document.body.textContent
  expect(text).toContain('Collaborators')
  expect(text).toContain('2 online · 1 editing')
  expect(text).toContain('Ada Lovelace')
  expect(text).toContain('(you)')
  expect(text).toContain('Grace Hopper')
  expect(text).toContain('Editing')
  expect(text).toContain('Viewing')
  expect(document.body.querySelectorAll('[data-cursor-color]')).toHaveLength(2)
  const rows = document.body.querySelectorAll('li > button, li > div')
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(row.className).toContain('w-full')
})

it('jumps to an editing collaborator but not to viewing or self rows', async () => {
  const onJumpToCollaborator = vi.fn()
  const collaborators = [
    {
      clientID: 1,
      self: true,
      name: 'Ada Lovelace',
      color: 'rgb(1, 2, 3)',
      focusing: true,
    },
    {
      clientID: 2,
      self: false,
      name: 'Grace Hopper',
      color: 'rgb(4, 5, 6)',
      focusing: true,
    },
    {
      clientID: 3,
      self: false,
      name: 'Alan Turing',
      color: 'rgb(7, 8, 9)',
      focusing: false,
    },
  ]
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={{ ...connected, collaborators }}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={() => {}}
        onJumpToCollaborator={onJumpToCollaborator}
      />,
    )
  })
  await act(async () => harness.container.querySelector('button')!.click())
  const jumps = document.body.querySelectorAll<HTMLButtonElement>(
    '[aria-label^="Jump to"]',
  )
  expect(jumps).toHaveLength(1)
  expect(jumps[0].getAttribute('aria-label')).toBe(
    "Jump to Grace Hopper's cursor",
  )
  await act(async () => jumps[0].click())
  expect(onJumpToCollaborator).toHaveBeenCalledWith(collaborators[1])
})

it('toggles the live collaboration kill switch from the menu', async () => {
  const onLiveCollaborationChange = vi.fn()
  await act(async () => {
    harness.root.render(
      <DocumentAccessStatus
        readOnly={false}
        realtime={connected}
        storageName="Google Drive"
        liveCollaboration={true}
        onLiveCollaborationChange={onLiveCollaborationChange}
      />,
    )
  })
  await act(async () => harness.container.querySelector('button')!.click())
  const toggle = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="switch"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(document.body.textContent).toContain('Live collaboration')
  expect(document.body.textContent).toContain('Connected')
  await act(async () => toggle.click())
  expect(onLiveCollaborationChange).toHaveBeenCalledWith(false)
})
