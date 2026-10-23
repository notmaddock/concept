import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Doc } from 'yjs'
import type { DocumentInfo, DocumentSyncStatus } from '#/lib/documents/storage'
import { DocumentWorkspace } from './DocumentWorkspace'
import { useDocumentWorkspace } from './document-workspace-context'

const mocks = vi.hoisted(() => ({
  useDocuments: vi.fn(),
  applyDocumentTheme: vi.fn(),
  resetDocumentTheme: vi.fn(),
  setDocumentTheme: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

vi.mock('#/hooks/use-documents', () => ({
  useDocuments: (id?: string) => mocks.useDocuments(id),
}))

vi.mock('#/lib/documents/theme-transition', () => ({
  applyDocumentTheme: mocks.applyDocumentTheme,
  resetDocumentTheme: mocks.resetDocumentTheme,
}))

vi.mock('#/lib/documents/document-theme', () => ({
  setDocumentTheme: mocks.setDocumentTheme,
}))

vi.mock('#/components/account/AccountManager', () => ({
  AccountManager: () => <div data-testid="account-manager" />,
}))

vi.mock('./DocumentList', () => ({
  DocumentList: ({
    documents,
    activeId,
    loading,
  }: {
    documents: Array<DocumentInfo>
    activeId?: string
    loading: boolean
  }) => (
    <div
      data-testid="document-list"
      data-active-id={activeId ?? ''}
      data-loading={String(loading)}
    >
      {documents.map((doc) => (
        <span key={doc.id}>{doc.name}</span>
      ))}
    </div>
  ),
}))

vi.mock('./DocumentSyncStatus', () => ({
  DocumentSyncStatus: ({
    status,
    onRetry,
  }: {
    status: DocumentSyncStatus
    onRetry?: () => void
  }) => (
    <div data-testid="sync-status" data-state={status.state}>
      <span>{status.message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry sync
        </button>
      )}
    </div>
  ),
}))

function WorkspaceTestControls() {
  const workspace = useDocumentWorkspace()
  return (
    <div data-testid="workspace-controls">
      <button type="button" onClick={() => workspace.openDocument()}>
        Trigger Open
      </button>
      <button type="button" onClick={() => workspace.copyDocument()}>
        Trigger Copy
      </button>
      <button
        type="button"
        onClick={() => workspace.importDocument('markdown')}
      >
        Trigger Import
      </button>
      <button type="button" onClick={() => workspace.showDetails()}>
        Trigger Details
      </button>
      <button type="button" onClick={() => workspace.shareDocument()}>
        Trigger Share
      </button>
      <button type="button" onClick={() => workspace.openPageSetup()}>
        Trigger Page Setup
      </button>
      <button type="button" onClick={() => void workspace.downloadDocument()}>
        Trigger Download
      </button>
      <button
        type="button"
        onClick={() => void workspace.exportDocument('markdown')}
      >
        Trigger Export
      </button>
      <button
        type="button"
        onClick={() => workspace.changeDocumentTheme('amber')}
      >
        Trigger Theme Amber
      </button>
    </div>
  )
}

vi.mock('./DocumentNavigation', () => ({
  DocumentNavigation: () => <WorkspaceTestControls />,
}))

vi.mock('./DocumentEditor', () => ({
  DocumentEditor: ({
    id,
    documentRef,
    onSyncStatusChange,
    pageSetupOpen,
  }: {
    id: string
    documentRef: React.RefObject<Doc | null>
    onSyncStatusChange: (status: DocumentSyncStatus, retry?: () => void) => void
    pageSetupOpen: boolean
  }) => (
    <div
      data-testid="document-editor"
      data-doc-id={id}
      data-page-setup={String(pageSetupOpen)}
    >
      <button
        type="button"
        onClick={() => {
          documentRef.current = new Doc()
        }}
      >
        Attach Doc Ref
      </button>
      <button
        type="button"
        onClick={() =>
          onSyncStatusChange(
            { state: 'error', message: 'Sync failed in test' },
            () => {},
          )
        }
      >
        Emit Sync Error
      </button>
    </div>
  ),
}))

vi.mock('./DocumentStorageDialog', () => ({
  DocumentStorageDialog: ({
    mode,
    importFormat,
    source,
    onClose,
  }: {
    mode: string
    importFormat?: string
    source?: { name: string }
    onClose: () => void
  }) => (
    <div
      data-testid="storage-dialog"
      data-mode={mode}
      data-format={importFormat ?? ''}
      data-source={source?.name ?? ''}
    >
      <button type="button" onClick={onClose}>
        Close Storage Dialog
      </button>
    </div>
  ),
}))

vi.mock('./DocumentDetails', () => ({
  DocumentDetailsDialog: ({
    document: docInfo,
    onOpenChange,
  }: {
    document: DocumentInfo
    onOpenChange: (open: boolean) => void
  }) => (
    <div data-testid="details-dialog" data-doc-name={docInfo.name}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close Details Dialog
      </button>
    </div>
  ),
}))

vi.mock('./DocumentShareDialog', () => ({
  DocumentShareDialog: ({
    onOpenChange,
  }: {
    onOpenChange: (open: boolean) => void
  }) => (
    <div data-testid="share-dialog">
      <button type="button" onClick={() => onOpenChange(false)}>
        Close Share Dialog
      </button>
    </div>
  ),
}))

const sampleLocalDoc: DocumentInfo = {
  id: 'doc-local-1',
  name: 'Architecture Plan',
  updatedAt: 1000,
}

const sampleCloudDoc: DocumentInfo = {
  id: 'doc-cloud-2',
  name: 'Cloud Roadmap',
  updatedAt: 2000,
  backing: {
    provider: 'google-drive',
    fileId: 'file-2',
    accountId: 'acc-1',
    syncedName: 'Cloud Roadmap',
  },
}

function makeLibraryState(overrides: Record<string, unknown> = {}) {
  return {
    documents: [sampleLocalDoc, sampleCloudDoc],
    document: undefined,
    loaded: true,
    error: '',
    creating: false,
    createDocument: vi.fn(),
    renameDocument: vi.fn(),
    renameDocumentById: vi.fn(),
    deleteDocument: vi.fn(),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  vi.clearAllMocks()
  window.document.title = 'Initial Title'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function clickButton(text: string) {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === text,
  )
  expect(btn, `Expected button "${text}"`).toBeDefined()
  return act(async () => {
    btn!.click()
  })
}

describe('DocumentWorkspace', () => {
  it('renders loading, empty library, and missing document states and resets theme on unmount', async () => {
    mocks.useDocuments.mockReturnValue(
      makeLibraryState({ loaded: false, document: undefined }),
    )

    await act(async () => {
      root.render(<DocumentWorkspace />)
    })
    expect(document.body.textContent).toContain('Loading documents…')
    expect(window.document.title).toBe('Concept')

    const createDocument = vi.fn()
    mocks.useDocuments.mockReturnValue(
      makeLibraryState({
        loaded: true,
        document: undefined,
        createDocument,
      }),
    )
    await act(async () => {
      root.render(<DocumentWorkspace />)
    })
    expect(document.body.textContent).toContain('What would you like to write?')
    expect(mocks.applyDocumentTheme).toHaveBeenCalledWith('default')

    await clickButton('New document')
    expect(createDocument).toHaveBeenCalledOnce()

    mocks.useDocuments.mockReturnValue(
      makeLibraryState({ loaded: true, document: undefined }),
    )
    await act(async () => {
      root.render(<DocumentWorkspace id="missing-doc-id" />)
    })
    expect(document.body.textContent).toContain('Document not found')
    expect(document.body.textContent).toContain(
      'This document is not available in this browser.',
    )

    await act(async () => {
      root.unmount()
    })
    expect(mocks.resetDocumentTheme).toHaveBeenCalledOnce()
    expect(window.document.title).toBe('Initial Title')
  })

  it('loads the active document editor, updates document title, and scopes sync status per document', async () => {
    mocks.useDocuments.mockImplementation((id?: string) =>
      makeLibraryState({
        document: id === sampleCloudDoc.id ? sampleCloudDoc : sampleLocalDoc,
      }),
    )

    await act(async () => {
      root.render(<DocumentWorkspace id={sampleLocalDoc.id} />)
    })

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="document-editor"]'),
      ).not.toBeNull()
    })

    expect(window.document.title).toBe('Architecture Plan — Concept')
    const syncEl = document.querySelector('[data-testid="sync-status"]')
    expect(syncEl?.getAttribute('data-state')).toBe('local')
    expect(syncEl?.textContent).toContain('Stored in this browser.')

    await clickButton('Emit Sync Error')
    expect(
      document
        .querySelector('[data-testid="sync-status"]')
        ?.getAttribute('data-state'),
    ).toBe('error')

    // Switching to another document clears the previous document's custom sync status
    await act(async () => {
      root.render(<DocumentWorkspace id={sampleCloudDoc.id} />)
    })
    expect(window.document.title).toBe('Cloud Roadmap — Concept')
    expect(
      document.querySelectorAll('input[aria-label="Document name"]'),
    ).toHaveLength(1)
    const switchedSync = document.querySelector('[data-testid="sync-status"]')
    expect(switchedSync?.getAttribute('data-state')).toBe('pending')
    expect(switchedSync?.textContent).toContain(
      'Opening document and checking cloud sync…',
    )
  })

  it('displays error alerts from library failures and unready workspace actions', async () => {
    mocks.useDocuments.mockReturnValue(
      makeLibraryState({
        document: sampleLocalDoc,
        error: 'Failed to open IndexedDB library.',
      }),
    )

    await act(async () => {
      root.render(<DocumentWorkspace id={sampleLocalDoc.id} />)
    })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Failed to open IndexedDB library.',
    )

    // Clear library error and test workspace action guards before refs are attached
    mocks.useDocuments.mockReturnValue(
      makeLibraryState({
        document: sampleLocalDoc,
        error: '',
      }),
    )
    await act(async () => {
      root.render(<DocumentWorkspace id={sampleLocalDoc.id} />)
    })
    expect(document.querySelector('[role="alert"]')).toBeNull()

    await clickButton('Trigger Copy')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Open a document and wait for it to load before making a copy.',
    )

    await clickButton('Trigger Download')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Open a document and wait for it to load before downloading.',
    )

    await clickButton('Trigger Export')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Open a document and wait for it to load before exporting.',
    )
  })

  it('opens and closes storage, details, share, and page setup dialogs and forwards theme changes', async () => {
    mocks.useDocuments.mockReturnValue(
      makeLibraryState({
        document: sampleLocalDoc,
      }),
    )

    await act(async () => {
      root.render(<DocumentWorkspace id={sampleLocalDoc.id} />)
    })

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="document-editor"]'),
      ).not.toBeNull()
    })

    // Attach Yjs Doc ref so copy and theme changes operate on an active doc
    await clickButton('Attach Doc Ref')
    await clickButton('Trigger Theme Amber')
    expect(mocks.setDocumentTheme).toHaveBeenCalledWith(
      expect.any(Doc),
      'amber',
    )

    // Open storage dialog in copy mode
    await clickButton('Trigger Copy')
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="storage-dialog"]'),
      ).not.toBeNull()
    })
    const copyDialog = document.querySelector('[data-testid="storage-dialog"]')!
    expect(copyDialog.getAttribute('data-mode')).toBe('copy')
    expect(copyDialog.getAttribute('data-source')).toBe('Architecture Plan')
    await clickButton('Close Storage Dialog')
    expect(document.querySelector('[data-testid="storage-dialog"]')).toBeNull()

    // Open storage dialog in import mode
    await clickButton('Trigger Import')
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="storage-dialog"]'),
      ).not.toBeNull()
    })
    const importDialog = document.querySelector(
      '[data-testid="storage-dialog"]',
    )!
    expect(importDialog.getAttribute('data-mode')).toBe('import')
    expect(importDialog.getAttribute('data-format')).toBe('markdown')
    await clickButton('Close Storage Dialog')

    // Open details dialog
    await clickButton('Trigger Details')
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="details-dialog"]'),
      ).not.toBeNull()
    })
    expect(
      document
        .querySelector('[data-testid="details-dialog"]')
        ?.getAttribute('data-doc-name'),
    ).toBe('Architecture Plan')
    await clickButton('Close Details Dialog')
    expect(document.querySelector('[data-testid="details-dialog"]')).toBeNull()

    // Open share dialog
    await clickButton('Trigger Share')
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="share-dialog"]'),
      ).not.toBeNull()
    })
    await clickButton('Close Share Dialog')
    expect(document.querySelector('[data-testid="share-dialog"]')).toBeNull()

    // Open page setup on editor
    expect(
      document
        .querySelector('[data-testid="document-editor"]')
        ?.getAttribute('data-page-setup'),
    ).toBe('false')
    await clickButton('Trigger Page Setup')
    expect(
      document
        .querySelector('[data-testid="document-editor"]')
        ?.getAttribute('data-page-setup'),
    ).toBe('true')
  })
})
