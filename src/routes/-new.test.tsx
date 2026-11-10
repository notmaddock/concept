import { expect, it, vi, beforeEach } from 'vitest'
import type { ComponentType, ReactNode } from 'react'
import type * as TanStackRouter from '@tanstack/react-router'
import { setupTestRoot } from '#/test/react-test'
import { waitForAct } from '#/test/wait-for-act'
import { Route } from './new/index'

const state = vi.hoisted(() => ({
  searchStr: '',
  connected: true,
  navigate: [] as Array<unknown>,
  connect: 0,
  localCreates: 0,
  createOptions: [] as Array<unknown>,
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
    create: vi.fn(async () => {
      state.localCreates++
      return { id: 'local-1', name: 'Untitled document', updatedAt: 0 }
    }),
  },
}))

vi.mock('#/lib/documents/drive/create', () => ({
  createBlankDriveDocument: vi.fn(async (options: unknown) => {
    state.createOptions.push(options)
    return { id: 'file-1' }
  }),
}))

const NewRoute = Route.options.component as ComponentType
const harness = setupTestRoot()

beforeEach(() => {
  state.searchStr = ''
  state.connected = true
  state.navigate = []
  state.connect = 0
  state.localCreates = 0
  state.createOptions = []
  vi.clearAllMocks()
})

function createState(value: object) {
  return `?state=${encodeURIComponent(JSON.stringify(value))}`
}

it('creates a local document when there is no Drive launch state', async () => {
  await harness.render(<NewRoute />)
  await waitForAct(() => {
    expect(state.localCreates).toBe(1)
    expect(state.navigate).toEqual([
      { to: '/', hash: 'Llocal-1', replace: true },
    ])
  })
})

it('creates a Drive document in the requested folder', async () => {
  state.searchStr = createState({
    action: 'create',
    folderId: 'folder-1',
    folderResourceKey: 'folder-key',
  })
  await harness.render(<NewRoute />)
  await waitForAct(() => {
    expect(state.createOptions).toEqual([
      { folderId: 'folder-1', folderResourceKey: 'folder-key' },
    ])
    expect(state.navigate).toEqual([
      { to: '/', hash: 'Gfile-1', replace: true },
    ])
  })
})

it('starts Google sign-in before creating a Drive document', async () => {
  state.connected = false
  state.searchStr = createState({ action: 'create', folderId: 'folder-1' })
  await harness.render(<NewRoute />)
  await waitForAct(() => expect(state.connect).toBe(1))
  expect(state.createOptions).toEqual([])
})

it('forwards an Open launch to the open route', async () => {
  state.searchStr = createState({ action: 'open', ids: ['file-1'] })
  await harness.render(<NewRoute />)
  expect(harness.container.textContent).toContain(
    'This link opens an existing document',
  )
  expect(harness.container.querySelector('a')?.getAttribute('href')).toBe(
    `/open${state.searchStr}`,
  )
  expect(state.localCreates).toBe(0)
  expect(state.createOptions).toEqual([])
})
