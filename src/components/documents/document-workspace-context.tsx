import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import type { ExportFormat } from '#/lib/documents/export'
import { useDocuments } from '#/hooks/use-documents'
import { afterPageLoad } from '#/lib/loading/after-page-load'
import { DocumentLoading } from './DocumentLoading'

const loadDocumentStorageDialog = () => import('./DocumentStorageDialog')
const DocumentStorageDialog = lazy(() =>
  loadDocumentStorageDialog().then((module) => ({
    default: module.DocumentStorageDialog,
  })),
)
const loadDocumentDetailsDialog = () => import('./DocumentDetails')
const DocumentDetailsDialog = lazy(() =>
  loadDocumentDetailsDialog().then((module) => ({
    default: module.DocumentDetailsDialog,
  })),
)
const loadDocumentShareDialog = () => import('./DocumentShareDialog')
const DocumentShareDialog = lazy(() =>
  loadDocumentShareDialog().then((module) => ({
    default: module.DocumentShareDialog,
  })),
)

function useWorkspaceState(id?: string) {
  const library = useDocuments(id)
  const { document } = library

  useEffect(() => {
    const previousTitle = window.document.title
    window.document.title = document ? `${document.name} — Concept` : 'Concept'
    return () => {
      window.document.title = previousTitle
    }
  }, [document?.name])
  const documentRef = useRef<Doc | null>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const [fileAction, setFileAction] = useState<'open' | 'copy' | null>(null)
  const [fileError, setFileError] = useState('')
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  function openDocument() {
    setFileAction('open')
  }

  function copyDocument() {
    if (documentRef.current && document) setFileAction('copy')
    else
      setFileError(
        'Open a document and wait for it to load before making a copy.',
      )
  }

  async function downloadDocument() {
    try {
      if (!document || !documentRef.current)
        throw new Error(
          'Open a document and wait for it to load before downloading.',
        )
      const source = { name: document.name, doc: documentRef.current }
      const { downloadConcept } = await import('#/lib/documents/concept-file')
      downloadConcept(source.name, source.doc)
      setFileError('')
    } catch (cause) {
      setFileError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the document.',
      )
    }
  }

  async function exportDocument(format: ExportFormat) {
    const editor = editorRef.current
    if (!document || !editor) {
      setFileError('Open a document and wait for it to load before exporting.')
      return
    }
    try {
      const { serializeExport, downloadExport } =
        await import('#/lib/documents/export')
      const file = await serializeExport(editor, document.name, format)
      downloadExport(document.name, file)
      setFileError('')
    } catch {
      setFileError('Could not export the document. Please try again.')
    }
  }

  const workspace = {
    ...library,
    error: library.error || fileError,
    enabled: Boolean(document),
    documentRef,
    editorRef,
    detailsOpen,
    onDetailsOpenChange: setDetailsOpen,
    showDetails: () => setDetailsOpen(true),
    shareOpen,
    onShareOpenChange: setShareOpen,
    shareDocument: () => setShareOpen(true),
    pageSetupOpen,
    onPageSetupOpenChange: setPageSetupOpen,
    openDocument,
    copyDocument,
    downloadDocument,
    exportDocument,
    openPageSetup: () => setPageSetupOpen(true),
    focusEditor: () => {
      editorRef.current?.getRootElement()?.focus({ preventScroll: true })
      editorRef.current?.focus()
    },
  }

  return { workspace, fileAction, closeFileDialog: () => setFileAction(null) }
}

const DocumentWorkspaceContext = createContext<
  ReturnType<typeof useWorkspaceState>['workspace'] | undefined
>(undefined)

export function DocumentWorkspaceProvider({
  id,
  children,
}: {
  id?: string
  children: ReactNode
}) {
  const { workspace, fileAction, closeFileDialog } = useWorkspaceState(id)
  const { document, documentRef } = workspace
  useEffect(
    () =>
      afterPageLoad(() =>
        Promise.all([
          loadDocumentStorageDialog(),
          loadDocumentDetailsDialog(),
          loadDocumentShareDialog(),
        ]),
      ),
    [],
  )

  return (
    <DocumentWorkspaceContext value={workspace}>
      {children}
      <Suspense fallback={<DocumentLoading label="Loading dialog…" />}>
        {workspace.detailsOpen && document && (
          <DocumentDetailsDialog
            key={document.id}
            document={document}
            documentRef={documentRef}
            editorRef={workspace.editorRef}
            onOpenChange={workspace.onDetailsOpenChange}
          />
        )}
        {workspace.shareOpen && (
          <DocumentShareDialog
            open={workspace.shareOpen}
            onOpenChange={workspace.onShareOpenChange}
            onCopy={workspace.copyDocument}
          />
        )}
        {fileAction && (
          <DocumentStorageDialog
            key={fileAction}
            mode={fileAction}
            source={
              document && documentRef.current
                ? { name: document.name, doc: documentRef.current }
                : undefined
            }
            onClose={closeFileDialog}
          />
        )}
      </Suspense>
    </DocumentWorkspaceContext>
  )
}

export function useDocumentWorkspace() {
  const context = useContext(DocumentWorkspaceContext)
  if (!context) {
    throw new Error(
      'useDocumentWorkspace must be used within a DocumentWorkspaceProvider',
    )
  }
  return context
}
