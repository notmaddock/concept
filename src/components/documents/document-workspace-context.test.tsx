import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DocumentInfo } from '#/lib/documents/storage'
import {
  DocumentWorkspaceProvider,
  useDocumentWorkspace,
} from './document-workspace-context'
import type { DocumentWorkspaceState } from './document-workspace-context'

const mocks = vi.hoisted(() => ({
  connected: true,
  listeners: new Set<() => void>(),
  refresh: vi.fn<() => Promise<Set<string>>>(),
  prepareAuth: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  navigate: vi.fn(async () => {}),
  deleteLocal: vi.fn<(id: string) => Promise<void>>(async () => {}),
  openPicker: vi.fn(),
  storageGet: vi.fn(async (_id?: string) => undefined),
  setOffline: vi.fn<(id: string, value: boolean) => Promise<void>>(
    async () => {},
  ),
  documents: [] as DocumentInfo[],
  document: undefined as DocumentInfo | undefined,
  status: { phase: 'local' as const },
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('#/hooks/use-documents', () => ({
  useDocuments: () => ({
    documents: mocks.documents,
    document: mocks.document,
    error: '',
  }),
}))
vi.mock('#/lib/documents/drive/picker', () => ({
  openGooglePicker: (options?: { fileId: string }) => mocks.openPicker(options),
}))
vi.mock('#/lib/documents/drive/auth', () => ({
  connectGoogleDrive: vi.fn(),
  getGoogleDriveToken: vi.fn(),
  prepareGoogleDriveAuth: () => mocks.prepareAuth(),
  disconnectGoogleDrive: () => mocks.disconnect(),
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
  documentStorage: {
    get: (id: string) => mocks.storageGet(id),
  },
  setDocumentOfflineAvailable: (id: string, value: boolean) =>
    mocks.setOffline(id, value),
}))
vi.mock('#/lib/documents/storage', () => ({
  localDocumentStorage: {
    delete: (id: string) => mocks.deleteLocal(id),
  },
}))
vi.mock('#/lib/documents/sync', () => ({
  documentSessions: new Map(),
  getSaveStatus: () => mocks.status,
  subscribeSaveStatus: () => () => {},
}))

let root: Root
let container: HTMLDivElement
let workspace: DocumentWorkspaceState

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.connected = true
  mocks.documents = []
  mocks.document = undefined
  mocks.refresh.mockReset()
  mocks.refresh.mockResolvedValue(new Set())
  mocks.prepareAuth.mockClear()
  mocks.disconnect.mockReset()
  mocks.navigate.mockClear()
  mocks.deleteLocal.mockClear()
  mocks.openPicker.mockReset()
  mocks.storageGet.mockReset()
  mocks.storageGet.mockResolvedValue(undefined)
  mocks.setOffline.mockClear()
  mocks.setOffline.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

it('restores the session on mount without probing it again on focus', async () => {
  mocks.refresh.mockResolvedValue(new Set())
  await act(async () => {
    root.render(<DocumentWorkspaceProvider>{null}</DocumentWorkspaceProvider>)
    await Promise.resolve()
  })
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
  vi.restoreAllMocks()
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
})

it('hides non-offline, non-dirty Drive documents when disconnected and deletes non-dirty Drive documents on disconnect', async () => {
  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  mocks.connected = false
  mocks.refresh.mockResolvedValue(new Set(['Gclean', 'Gdirty', 'Goffline']))
  mocks.disconnect.mockImplementation(async () => {
    mocks.connected = false
    for (const listener of mocks.listeners) listener()
  })
  mocks.documents = [
    { id: 'local-1', name: 'Local Doc', updatedAt: 1 },
    {
      id: 'Gclean',
      name: 'Clean Drive Doc',
      updatedAt: 2,
      drive: { fileId: 'clean', offlineAvailable: false, dirty: false },
    },
    {
      id: 'Gdirty',
      name: 'Dirty Drive Doc',
      updatedAt: 3,
      drive: { fileId: 'dirty', offlineAvailable: false, dirty: true },
    },
    {
      id: 'Goffline',
      name: 'Offline Drive Doc',
      updatedAt: 4,
      drive: { fileId: 'offline', offlineAvailable: true, dirty: false },
    },
  ]

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

  expect(workspace.documents.map((item) => item.id)).toEqual([
    'local-1',
    'Gdirty',
    'Goffline',
  ])

  mocks.connected = true
  mocks.document = mocks.documents[1]
  await act(async () => {
    for (const listener of mocks.listeners) listener()
  })
  expect(workspace.documents.map((item) => item.id)).toEqual([
    'local-1',
    'Gclean',
    'Gdirty',
    'Goffline',
  ])

  act(() => {
    workspace.copyDocument()
  })
  expect(toastErrorSpy).toHaveBeenCalledWith(
    'Open a document and wait for it to load before making a copy.',
    { id: 'document-workspace-error' },
  )

  await act(async () => {
    workspace.disconnectDrive()
  })
  expect(mocks.deleteLocal).toHaveBeenCalledWith('Gclean')
  expect(mocks.deleteLocal).toHaveBeenCalledWith('Goffline')
  expect(mocks.deleteLocal).not.toHaveBeenCalledWith('Gdirty')
  expect(mocks.deleteLocal).not.toHaveBeenCalledWith('local-1')
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
})

it('preserves current state and does not navigate when picker is cancelled', async () => {
  mocks.openPicker.mockResolvedValueOnce(null)
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  await act(async () => {
    await workspace.openGoogleDrivePicker()
  })

  expect(mocks.openPicker).toHaveBeenCalledOnce()
  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(workspace.pickerLoading).toBe(false)
})

it('navigates to selected Drive document and registers it in storage even with different ID', async () => {
  mocks.openPicker.mockResolvedValueOnce({
    id: 'picked-123',
    name: 'Shared.concept',
    mimeType: 'application/vnd.concept+json',
  })
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  await act(async () => {
    await workspace.openGoogleDrivePicker()
  })

  expect(mocks.openPicker).toHaveBeenCalledOnce()
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/', hash: 'Gpicked-123' })
  expect(mocks.storageGet).toHaveBeenCalledWith('Gpicked-123')
})

it('shows toast error when picker fails to open', async () => {
  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  mocks.openPicker.mockRejectedValueOnce(
    new Error('Network error loading picker'),
  )
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  await act(async () => {
    await workspace.openGoogleDrivePicker()
  })

  expect(toastErrorSpy).toHaveBeenCalledWith('Network error loading picker', {
    id: 'google-picker-error',
  })
})

it('retries the editor after selecting the active document again', async () => {
  mocks.openPicker.mockResolvedValueOnce({ id: 'active' })
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider id="Gactive">
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })
  const previousRevision = workspace.connectionRevision
  await act(async () => workspace.openGoogleDrivePicker())
  expect(workspace.connectionRevision).toBe(previousRevision + 1)
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/', hash: 'Gactive' })
  expect(mocks.openPicker).toHaveBeenCalledWith({ fileId: 'active' })
})

it('retains the current document and reports one error when selected file registration fails', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
  mocks.openPicker.mockResolvedValueOnce({ id: 'inaccessible' })
  mocks.storageGet.mockRejectedValueOnce(new Error('Access denied'))
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })
  await act(async () => workspace.openGoogleDrivePicker())
  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledExactlyOnceWith('Access denied', {
    id: 'google-picker-error',
  })
})

it('delegates setOfflineAvailable safely to setDocumentOfflineAvailable', async () => {
  mocks.document = { id: 'Gdoc1', name: 'Drive Document', updatedAt: 1 }
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider id="Gdoc1">
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  await act(async () => {
    workspace.setOfflineAvailable(true)
  })
  expect(mocks.setOffline).toHaveBeenCalledWith('Gdoc1', true)

  await act(async () => {
    workspace.setOfflineAvailable(false)
  })
  expect(mocks.setOffline).toHaveBeenCalledWith('Gdoc1', false)
})

it('shows toast error when setDocumentOfflineAvailable fails', async () => {
  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  mocks.document = { id: 'Gdoc1', name: 'Drive Document', updatedAt: 1 }
  mocks.setOffline.mockRejectedValueOnce(new Error('Drive quota exceeded'))
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider id="Gdoc1">
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  await act(async () => {
    workspace.setOfflineAvailable(true)
  })
  expect(toastErrorSpy).toHaveBeenCalledWith('Drive quota exceeded', {
    id: 'document-workspace-error',
  })
})

it('ignores setOfflineAvailable when no document is active', async () => {
  mocks.document = undefined
  function Harness() {
    workspace = useDocumentWorkspace()
    return null
  }
  await act(async () => {
    root.render(
      <DocumentWorkspaceProvider>
        <Harness />
      </DocumentWorkspaceProvider>,
    )
    await Promise.resolve()
  })

  act(() => {
    workspace.setOfflineAvailable(true)
  })
  expect(mocks.setOffline).not.toHaveBeenCalled()
})

it('memoizes workspace value and action callbacks across re-renders when state is unchanged', async () => {
  mocks.document = { id: 'doc-1', name: 'Doc 1', updatedAt: 1 }
  const snapshots: DocumentWorkspaceState[] = []

  function Harness() {
    const ws = useDocumentWorkspace()
    snapshots.push(ws)
    return null
  }

  function App({ count }: { count: number }) {
    return (
      <DocumentWorkspaceProvider id="doc-1">
        <Harness />
        <span data-count={count} />
      </DocumentWorkspaceProvider>
    )
  }

  await act(async () => {
    root.render(<App count={1} />)
    await Promise.resolve()
  })

  const initial = snapshots[snapshots.length - 1]

  await act(async () => {
    root.render(<App count={2} />)
    await Promise.resolve()
  })

  const afterRerender = snapshots[snapshots.length - 1]

  expect(afterRerender).toBe(initial)
  expect(afterRerender.connectDrive).toBe(initial.connectDrive)
  expect(afterRerender.openGoogleDrivePicker).toBe(
    initial.openGoogleDrivePicker,
  )
  expect(afterRerender.disconnectDrive).toBe(initial.disconnectDrive)
  expect(afterRerender.saveToDrive).toBe(initial.saveToDrive)
  expect(afterRerender.syncNow).toBe(initial.syncNow)
  expect(afterRerender.setOfflineAvailable).toBe(initial.setOfflineAvailable)
  expect(afterRerender.copyDocument).toBe(initial.copyDocument)
  expect(afterRerender.downloadDocument).toBe(initial.downloadDocument)
  expect(afterRerender.exportDocument).toBe(initial.exportDocument)
  expect(afterRerender.focusEditor).toBe(initial.focusEditor)
  expect(afterRerender.createDocument).toBe(initial.createDocument)
  expect(afterRerender.renameDocument).toBe(initial.renameDocument)
  expect(afterRerender.renameDocumentById).toBe(initial.renameDocumentById)
  expect(afterRerender.deleteDocument).toBe(initial.deleteDocument)

  // Opening a document dialog changes fileAction inside useWorkspaceState, but not workspace
  act(() => {
    initial.openDocument()
  })

  const afterAction = snapshots[snapshots.length - 1]
  expect(afterAction).toBe(initial)
})
