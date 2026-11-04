import { act, useEffect } from 'react'
import type { ComponentType } from 'react'
import type * as TanStackRouter from '@tanstack/react-router'
import { hydrateRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './index'

const state = vi.hoisted(() => ({
  hash: '',
  workspaceRenders: [] as Array<string | undefined>,
  workspaceEffects: [] as Array<string | undefined>,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof TanStackRouter>()),
  useLocation: ({
    select,
  }: {
    select: (location: { hash: string }) => unknown
  }) => select({ hash: state.hash }),
}))

vi.mock('#/components/documents/DocumentWorkspace', () => ({
  DocumentWorkspace: ({ id }: { id?: string }) => {
    state.workspaceRenders.push(id)
    useEffect(() => {
      state.workspaceEffects.push(id)
    }, [id])
    return (
      <div data-document-id={id}>
        {id ? 'Opening document…' : 'Loading documents…'}
      </div>
    )
  },
}))

const DocumentRoute = Route.options.component as ComponentType
let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.hash = ''
  state.workspaceRenders = []
  state.workspaceEffects = []
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(() => root?.unmount())
  root = undefined
  container.remove()
})

it.each([
  ['Gdrive-file-id', 'Gdrive-file-id'],
  ['Llocal-document-id', 'local-document-id'],
])(
  'hydrates the hash URL #%s without a mismatched or default workspace',
  async (hash, id) => {
    const html = renderToString(<DocumentRoute />)
    expect(html).toContain('Loading documents…')
    expect(state.workspaceRenders).toEqual([])
    container.innerHTML = html
    state.hash = hash
    const hydrationError = vi.fn()
    await act(() => {
      root = hydrateRoot(container, <DocumentRoute />, {
        onRecoverableError: hydrationError,
      })
    })
    expect(hydrationError).not.toHaveBeenCalled()
    expect(
      container
        .querySelector('[data-document-id]')
        ?.getAttribute('data-document-id'),
    ).toBe(id)
    expect(state.workspaceRenders.length).toBeGreaterThan(0)
    expect(state.workspaceRenders.every((rendered) => rendered === id)).toBe(
      true,
    )
    expect(state.workspaceEffects).toEqual([id])
  },
)

it('mounts the default workspace only after hydration when no document hash exists', async () => {
  container.innerHTML = renderToString(<DocumentRoute />)
  expect(state.workspaceRenders).toEqual([])
  await act(() => {
    root = hydrateRoot(container, <DocumentRoute />)
  })
  expect(state.workspaceEffects).toEqual([undefined])
})

describe('workspace context, editor error empty state, and save status', () => {
  it('hides non-offline, non-dirty Drive documents when disconnected on reload and deletes them on disconnect', async () => {
    const { createRoot } = await import('react-dom/client')
    const { toast } = await import('sonner')
    const router = await import('@tanstack/react-router')
    const auth = await import('#/lib/documents/drive/auth')
    const docStorage = await import('#/lib/documents/document-storage')
    const { localDocumentStorage } = await import('#/lib/documents/storage')
    const useDocs = await import('#/hooks/use-documents')
    const { DocumentWorkspaceProvider, useDocumentWorkspace } =
      await import('#/components/documents/document-workspace-context')

    const navigateSpy = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(router, 'useNavigate').mockReturnValue(navigateSpy)
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    vi.spyOn(auth, 'prepareGoogleDriveAuth').mockResolvedValue(undefined)
    let connected = false
    const authListeners = new Set<() => void>()
    vi.spyOn(auth, 'isGoogleDriveConnected').mockImplementation(() => connected)
    vi.spyOn(auth, 'subscribeGoogleDriveAuth').mockImplementation(
      (listener) => {
        authListeners.add(listener)
        return () => {
          authListeners.delete(listener)
        }
      },
    )
    vi.spyOn(auth, 'disconnectGoogleDrive').mockImplementation(async () => {
      connected = false
      authListeners.forEach((listener) => listener())
    })
    vi.spyOn(docStorage, 'refreshDriveDocuments').mockResolvedValue(
      new Set(['Gclean', 'Gdirty', 'Goffline']),
    )
    const deleteSpy = vi
      .spyOn(localDocumentStorage, 'delete')
      .mockResolvedValue(undefined)

    const docs = [
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
    let currentDoc: (typeof docs)[number] | undefined = undefined
    vi.spyOn(useDocs, 'useDocuments').mockImplementation(() => ({
      documents: docs,
      document: currentDoc,
      loaded: true,
      error: '',
      creating: false,
      createDocument: vi.fn(),
      renameDocument: vi.fn(),
      renameDocumentById: vi.fn(),
      deleteDocument: vi.fn(),
    }))

    let workspace!: ReturnType<typeof useDocumentWorkspace>
    function Harness() {
      workspace = useDocumentWorkspace()
      return null
    }

    const testRoot = createRoot(container)
    try {
      await act(() =>
        testRoot.render(
          <DocumentWorkspaceProvider>
            <Harness />
          </DocumentWorkspaceProvider>,
        ),
      )

      // Disconnected on initial load (!driveIds && !driveConnected): only local, dirty, and offline Drive docs appear
      expect(workspace.documents.map((item) => item.id)).toEqual([
        'local-1',
        'Gdirty',
        'Goffline',
      ])

      // Connect Drive and open Gclean
      connected = true
      currentDoc = docs[1]
      await act(async () => {
        authListeners.forEach((listener) => listener())
      })
      expect(workspace.documents.map((item) => item.id)).toEqual([
        'local-1',
        'Gclean',
        'Gdirty',
        'Goffline',
      ])

      // Copy before editor is ready fires toast.error directly
      act(() => {
        workspace.copyDocument()
      })
      expect(toastErrorSpy).toHaveBeenCalledWith(
        'Open a document and wait for it to load before making a copy.',
        { id: 'document-workspace-error' },
      )

      // Disconnect Drive: deletes non-dirty Drive docs (Gclean, Goffline) and navigates to '/'
      await act(async () => {
        workspace.disconnectDrive()
      })
      expect(deleteSpy).toHaveBeenCalledWith('Gclean')
      expect(deleteSpy).toHaveBeenCalledWith('Goffline')
      expect(deleteSpy).not.toHaveBeenCalledWith('Gdirty')
      expect(deleteSpy).not.toHaveBeenCalledWith('local-1')
      expect(navigateSpy).toHaveBeenCalledWith({ to: '/' })
    } finally {
      await act(() => testRoot.unmount())
      vi.restoreAllMocks()
    }
  })

  it('renders an empty error state with toast notification and Connect Google Drive CTA in DocumentEditor, and muted error text in DocumentSaveStatus', async () => {
    const { createRef } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { toast } = await import('sonner')
    const auth = await import('#/lib/documents/drive/auth')
    const { documentStorage } = await import('#/lib/documents/document-storage')
    const { DocumentEditor } =
      await import('#/components/documents/DocumentEditor')
    const { DocumentSaveStatus } =
      await import('#/components/documents/DocumentSaveStatus')

    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    vi.spyOn(auth, 'isGoogleDriveConnected').mockReturnValue(false)
    vi.spyOn(documentStorage, 'open').mockImplementation(() => ({
      whenSynced: Promise.reject(
        new auth.GoogleDriveAuthError('Reconnect Google Drive'),
      ),
      destroy: () => Promise.resolve(),
    }))

    const onConnectDrive = vi.fn()
    const testRoot = createRoot(container)
    try {
      await act(() =>
        testRoot.render(
          <div>
            <DocumentSaveStatus
              status={{ phase: 'error', error: 'Drive sync failed' }}
              provider="google-drive"
            />
            <DocumentEditor
              id="Gdoc-1"
              documentRef={createRef()}
              pageSetupOpen={false}
              onPageSetupOpenChange={() => {}}
              onConnectDrive={onConnectDrive}
            />
          </div>,
        ),
      )

      await vi.waitFor(async () => {
        await act(async () => {})
        expect(toastErrorSpy).toHaveBeenCalledWith(
          'Could not open this document. Reconnect Google Drive',
          { id: 'document-open:Gdoc-1' },
        )
        const empty = container.querySelector('[data-slot="empty"]')
        expect(empty).not.toBeNull()
        expect(
          empty?.querySelector('[data-slot="empty-title"]')?.textContent,
        ).toBe('Could not open this document')
        expect(
          empty?.querySelector('[data-slot="empty-description"]')?.textContent,
        ).toBe('Reconnect Google Drive')
        expect(container.querySelector('[role="alert"]')).toBeNull()
      })

      const connectBtn = Array.from(container.querySelectorAll('button')).find(
        (btn) => btn.textContent.includes('Connect Google Drive'),
      )
      expect(connectBtn).not.toBeUndefined()
      await act(() => {
        connectBtn?.click()
      })
      expect(onConnectDrive).toHaveBeenCalledOnce()

      const statusTrigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Could not save to Drive"]',
      )
      expect(statusTrigger).not.toBeNull()
      await act(() => {
        statusTrigger?.click()
      })
      const errorText = Array.from(document.body.querySelectorAll('p')).find(
        (el) => el.textContent === 'Drive sync failed',
      )
      expect(errorText).not.toBeUndefined()
      expect(errorText?.getAttribute('role')).toBeNull()
      expect(errorText?.className).toContain('text-muted-foreground')
      expect(errorText?.className).not.toContain('text-destructive')
    } finally {
      await act(() => testRoot.unmount())
      vi.restoreAllMocks()
    }
  })
})
