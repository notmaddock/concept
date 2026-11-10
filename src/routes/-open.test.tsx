import { expect, it, vi, beforeEach } from 'vitest'
import type { ComponentType, ReactNode } from 'react'
import type * as TanStackRouter from '@tanstack/react-router'
import { setupTestRoot } from '#/test/react-test'
import { waitForAct } from '#/test/wait-for-act'
import { DriveError } from '#/lib/documents/drive/api'
import { Route } from './open/index'

const state = vi.hoisted(() => ({
  searchStr: '',
  connected: true,
  get: [] as Array<[string, string | undefined]>,
  navigate: [] as Array<unknown>,
  connect: 0,
  getError: undefined as Error | undefined,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof TanStackRouter>()),
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useLocation: ({
    select,
  }: {
    select: (location: { searchStr: string }) => unknown
  }) => select({ searchStr: state.searchStr }),
  useNavigate: () => (options: unknown) => {
    state.navigate.push(options)
  },
}))

vi.mock('#/lib/documents/drive/auth', () => ({
  prepareGoogleDriveAuth: vi.fn(async () => {}),
  isGoogleDriveConnected: () => state.connected,
  connectGoogleDrive: vi.fn(async () => {
    state.connect++
  }),
  isGoogleDriveAuthError: (error: unknown) =>
    error instanceof Error && error.name === 'GoogleDriveAuthError',
}))

vi.mock('#/lib/documents/document-storage', () => ({
  documentStorage: {
    get: vi.fn(async (id: string, resourceKey?: string) => {
      state.get.push([id, resourceKey])
      if (state.getError) throw state.getError
      return { id, name: 'Doc', updatedAt: 0 }
    }),
  },
}))

const OpenRoute = Route.options.component as ComponentType
const harness = setupTestRoot()

beforeEach(() => {
  state.searchStr = ''
  state.connected = true
  state.get = []
  state.navigate = []
  state.connect = 0
  state.getError = undefined
  vi.clearAllMocks()
})

function openState(value: object) {
  return `?state=${encodeURIComponent(JSON.stringify(value))}`
}

it('opens the first Drive file with its resource key', async () => {
  state.searchStr = openState({
    action: 'open',
    ids: ['file-1', 'file-2'],
    resourceKeys: { 'file-1': 'key-1' },
  })
  await harness.render(<OpenRoute />)
  await waitForAct(() => {
    expect(state.get).toEqual([['Gfile-1', 'key-1']])
    expect(state.navigate).toEqual([
      { to: '/', hash: 'Gfile-1', replace: true },
    ])
  })
})

it('starts Google sign-in when Drive is not connected', async () => {
  state.connected = false
  state.searchStr = openState({ action: 'open', ids: ['file-1'] })
  await harness.render(<OpenRoute />)
  await waitForAct(() => expect(state.connect).toBe(1))
  expect(state.get).toEqual([])
})

it('offers the Drive picker when access was not granted', async () => {
  state.getError = new DriveError(403, 'No access')
  state.searchStr = openState({ action: 'open', ids: ['file-1'] })
  await harness.render(<OpenRoute />)
  await waitForAct(() =>
    expect(harness.container.textContent).toContain(
      'didn’t grant access to this document',
    ),
  )
  expect(harness.container.textContent).toContain('Choose in Google Drive')
})

it('explains a missing Drive launch state', async () => {
  await harness.render(<OpenRoute />)
  expect(harness.container.textContent).toContain(
    'doesn’t include a Google Drive document',
  )
})
