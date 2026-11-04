import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  DocumentWorkspaceProvider,
  useDocumentWorkspace,
} from './document-workspace-context'

const mocks = vi.hoisted(() => ({
  connected: true,
  listeners: new Set<() => void>(),
  refresh: vi.fn<() => Promise<Set<string>>>(),
  prepareAuth: vi.fn(async () => {}),
  status: { phase: 'local' as const },
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('#/hooks/use-documents', () => ({
  useDocuments: () => ({ documents: [], document: undefined, error: '' }),
}))
vi.mock('#/lib/documents/drive/auth', () => ({
  connectGoogleDrive: vi.fn(),
  getGoogleDriveToken: vi.fn(),
  prepareGoogleDriveAuth: () => mocks.prepareAuth(),
  disconnectGoogleDrive: vi.fn(),
  isGoogleDriveConnected: () => mocks.connected,
  subscribeGoogleDriveAuth: (listener: () => void) => {
    mocks.listeners.add(listener)
    return () => {
      mocks.listeners.delete(listener)
    }
  },
}))
vi.mock('#/lib/documents/document-storage', () => ({
  refreshDriveDocuments: () => mocks.refresh(),
  documentStorage: {},
}))
vi.mock('#/lib/documents/sync', () => ({
  documentSessions: new Map(),
  getSaveStatus: () => mocks.status,
  subscribeSaveStatus: () => () => {},
}))

let root: Root
let container: HTMLDivElement
let workspace: ReturnType<typeof useDocumentWorkspace>

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.connected = true
  mocks.refresh.mockReset()
  mocks.prepareAuth.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

it('restores the session on mount without probing it again on focus', async () => {
  mocks.refresh.mockResolvedValue(new Set())
  await act(() =>
    root.render(<DocumentWorkspaceProvider>{null}</DocumentWorkspaceProvider>),
  )
  expect(mocks.prepareAuth).toHaveBeenCalledOnce()
  await act(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
  })
  expect(mocks.prepareAuth).toHaveBeenCalledOnce()
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  expect(mocks.listeners.size).toBe(0)
})

it('clears source loading when authentication expires before the Drive fetch completes', async () => {
  let resolveFetch!: (ids: Set<string>) => void
  mocks.refresh.mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve
    }),
  )
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(() =>
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    ),
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(workspace.driveConnected).toBe(true)
  expect(workspace.driveLoading).toBe(true)
  await act(() => {
    mocks.connected = false
    for (const listener of mocks.listeners) listener()
  })
  expect(workspace.driveConnected).toBe(false)
  expect(workspace.driveLoading).toBe(false)
  await act(() => resolveFetch(new Set(['Gstale-result'])))
  expect(workspace.driveLoading).toBe(false)
  expect(workspace.driveError).toBe('')
})
