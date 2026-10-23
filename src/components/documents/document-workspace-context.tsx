import { setDocumentTheme } from '#/lib/documents/document-theme'
import type { DocumentTheme } from '#/lib/documents/document-theme'
import {
  createContext,
  useCallback,
  lazy,
  useMemo,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import type { DocumentSyncStatus } from '#/lib/documents/storage'
import type { ImportFormat } from '#/lib/documents/import/formats'
import type { ExportFormat } from '#/lib/documents/export'
import { useDocuments } from '#/hooks/use-documents'
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

  const [sync, setSync] = useState<{
    id?: string
    status: DocumentSyncStatus
    retry?: () => void
  }>()
  const onSyncStatusChange = useCallback(
    (status: DocumentSyncStatus, retry?: () => void) => {
      setSync({ id, status, retry })
    },
    [id],
  )
  const documentName = document?.name
  useEffect(() => {
    const previousTitle = window.document.title
    window.document.title =
      documentName === undefined ? 'Concept' : `${documentName} — Concept`
    return () => {
      window.document.title = previousTitle
    }
  }, [documentName])
  const documentRef = useRef<Doc | null>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const [fileAction, setFileAction] = useState<
    'open' | 'copy' | ImportFormat | null
  >(null)
  const [fileError, setFileError] = useState('')
  const [documentTheme, onDocumentThemeChange] =
    useState<DocumentTheme>('default')
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const openDocument = useCallback(() => {
    setFileAction('open')
  }, [])

  const copyDocument = useCallback(() => {
    if (documentRef.current && document) setFileAction('copy')
    else
      setFileError(
        'Open a document and wait for it to load before making a copy.',
      )
  }, [document])

  const downloadDocument = useCallback(async () => {
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
  }, [document])

  const exportDocument = useCallback(
    async (format: ExportFormat) => {
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
    },
    [document],
  )

  const changeDocumentTheme = useCallback((theme: DocumentTheme) => {
    if (documentRef.current) setDocumentTheme(documentRef.current, theme)
  }, [])

  const showDetails = useCallback(() => setDetailsOpen(true), [])
  const shareDocument = useCallback(() => setShareOpen(true), [])
  const openPageSetup = useCallback(() => setPageSetupOpen(true), [])
  const importDocument = useCallback(
    (format: ImportFormat) => setFileAction(format),
    [],
  )
  const focusEditor = useCallback(() => {
    editorRef.current?.getRootElement()?.focus({ preventScroll: true })
    editorRef.current?.focus()
  }, [])
  const closeFileDialog = useCallback(() => setFileAction(null), [])

  const syncStatus = sync?.id === id ? sync?.status : undefined
  const retrySync = sync?.id === id ? sync?.retry : undefined
  const error = library.error || fileError
  const enabled = Boolean(document)

  const workspace = useMemo(
    () => ({
      ...library,
      syncStatus,
      retrySync,
      onSyncStatusChange,
      documentTheme,
      onDocumentThemeChange,
      changeDocumentTheme,
      error,
      enabled,
      documentRef,
      editorRef,
      detailsOpen,
      onDetailsOpenChange: setDetailsOpen,
      showDetails,
      shareOpen,
      onShareOpenChange: setShareOpen,
      shareDocument,
      pageSetupOpen,
      onPageSetupOpenChange: setPageSetupOpen,
      openDocument,
      importDocument,
      copyDocument,
      downloadDocument,
      exportDocument,
      openPageSetup,
      focusEditor,
    }),
    [
      library,
      syncStatus,
      retrySync,
      onSyncStatusChange,
      documentTheme,
      onDocumentThemeChange,
      changeDocumentTheme,
      error,
      enabled,
      documentRef,
      editorRef,
      detailsOpen,
      showDetails,
      shareOpen,
      shareDocument,
      pageSetupOpen,
      openDocument,
      importDocument,
      copyDocument,
      downloadDocument,
      exportDocument,
      openPageSetup,
      focusEditor,
    ],
  )

  return { workspace, fileAction, closeFileDialog }
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
            mode={
              fileAction === 'open' || fileAction === 'copy'
                ? fileAction
                : 'import'
            }
            importFormat={
              fileAction === 'open' || fileAction === 'copy'
                ? undefined
                : fileAction
            }
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
