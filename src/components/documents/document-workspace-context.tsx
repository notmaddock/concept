import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { DocumentWorkspaceContext } from './document-workspace-store'
import { documentHash } from '#/lib/documents/document-url'
import { downloadConcept } from '#/lib/documents/concept-file'
import { downloadExport, serializeExport } from '#/lib/documents/export'
import {
  connectGoogleDrive,
  prepareGoogleDriveAuth,
  disconnectGoogleDrive,
  isGoogleDriveConnected,
  subscribeGoogleDriveAuth,
} from '#/lib/documents/drive/auth'
import {
  refreshDriveDocuments,
  documentStorage,
  setDocumentOfflineAvailable,
} from '#/lib/documents/document-storage'
import { openGooglePicker } from '#/lib/documents/drive/picker'
import { localDocumentStorage } from '#/lib/documents/storage'
import {
  documentSessions,
  getSaveStatus,
  subscribeSaveStatus,
} from '#/lib/documents/sync'
import type { ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import type { ImportFormat } from '#/lib/documents/import/formats'
import type { ExportFormat } from '#/lib/documents/export'
import { useDocuments } from '#/hooks/use-documents'
import { DocumentLoading } from './status/DocumentLoading'

export { useDocumentWorkspace } from './document-workspace-store'

const loadDocumentStorageDialog = () =>
  import('./dialogs/DocumentStorageDialog')
const DocumentStorageDialog = lazy(() =>
  loadDocumentStorageDialog().then((module) => ({
    default: module.DocumentStorageDialog,
  })),
)
const loadDocumentDetailsDialog = () => import('./dialogs/DocumentDetails')
const DocumentDetailsDialog = lazy(() =>
  loadDocumentDetailsDialog().then((module) => ({
    default: module.DocumentDetailsDialog,
  })),
)
const loadDocumentShareDialog = () => import('./dialogs/DocumentShareDialog')
const DocumentShareDialog = lazy(() =>
  loadDocumentShareDialog().then((module) => ({
    default: module.DocumentShareDialog,
  })),
)
const SaveToDriveDialog = lazy(() =>
  import('./dialogs/SaveToDriveDialog').then((module) => ({
    default: module.SaveToDriveDialog,
  })),
)

function useWorkspaceState(id?: string) {
  const navigate = useNavigate()
  const library = useDocuments(id)
  const { document } = library

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
  const cursorsContainerRef = useRef<HTMLDivElement | null>(null)
  const [fileAction, setFileAction] = useState<
    'open' | 'copy' | ImportFormat | null
  >(null)
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [saveToDriveOpen, setSaveToDriveOpen] = useState(false)
  const [driveLoading, setDriveLoading] = useState(false)
  useEffect(() => {
    if (library.error)
      toast.error(library.error, { id: 'document-workspace-error' })
  }, [library.error])
  const [driveIds, setDriveIds] = useState<Set<string>>()
  const driveConnectionPending = useRef(false)
  const driveConnected = useSyncExternalStore(
    subscribeGoogleDriveAuth,
    isGoogleDriveConnected,
    () => false,
  )
  const [connectionRevision, setConnectionRevision] = useState(0)
  const saveStatus = useSyncExternalStore(
    subscribeSaveStatus,
    () => getSaveStatus(document?.id ?? ''),
    () => getSaveStatus(''),
  )
  useEffect(() => {
    const refresh = () => {
      void prepareGoogleDriveAuth().catch(() => {})
    }
    refresh()
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('online', refresh)
    }
  }, [])
  useEffect(() => {
    if (!driveConnected) {
      setDriveLoading(false)
      return
    }
    if (driveConnectionPending.current) return
    let active = true
    setDriveLoading(true)
    void refreshDriveDocuments()
      .then((ids) => {
        if (active) setDriveIds(ids)
      })
      .catch((cause: unknown) => {
        if (active)
          toast.error(
            cause instanceof Error
              ? cause.message
              : 'Could not load Drive documents.',
            { id: 'document-workspace-error' },
          )
      })
      .finally(() => {
        if (active) setDriveLoading(false)
      })
    return () => {
      active = false
    }
  }, [driveConnected])

  const libraryRef = useRef(library)
  libraryRef.current = library

  const createDocument = useCallback(
    () => libraryRef.current.createDocument(),
    [],
  )
  const renameDocument = useCallback(
    (name: string) => libraryRef.current.renameDocument(name),
    [],
  )
  const renameDocumentById = useCallback(
    (documentId: string, name: string) =>
      libraryRef.current.renameDocumentById(documentId, name),
    [],
  )
  const deleteDocument = useCallback(
    (documentId: string) => libraryRef.current.deleteDocument(documentId),
    [],
  )

  const connectDrive = useCallback(async () => {
    setDriveLoading(true)
    driveConnectionPending.current = true
    try {
      if (!isGoogleDriveConnected()) {
        await connectGoogleDrive()
        return
      }
      setDriveIds(await refreshDriveDocuments())
      if (id?.startsWith('G')) await documentStorage.get(id)
      if (!documentRef.current) setConnectionRevision((value) => value + 1)
      else await documentSessions.get(document?.id ?? '')?.sync(true)
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not connect to Drive.',
        { id: 'document-workspace-error' },
      )
    } finally {
      driveConnectionPending.current = false
      setDriveLoading(false)
    }
  }, [id, document?.id])

  const [pickerLoading, setPickerLoading] = useState(false)
  const pickerPending = useRef(false)

  const openGoogleDrivePicker = useCallback(async () => {
    if (pickerPending.current) return
    pickerPending.current = true
    setPickerLoading(true)
    try {
      const picked = await openGooglePicker(
        id?.startsWith('G') ? { fileId: id.slice(1) } : undefined,
      )
      if (!picked) return
      const targetId = `G${picked.id}`
      await documentStorage.get(targetId)
      if (targetId === id) setConnectionRevision((value) => value + 1)
      await navigate({ to: '/', hash: documentHash(targetId) })
      try {
        setDriveIds(await refreshDriveDocuments())
      } catch {}
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not open Google Drive file picker.',
        { id: 'google-picker-error' },
      )
    } finally {
      pickerPending.current = false
      setPickerLoading(false)
    }
  }, [id, navigate])

  const openDocument = useCallback(() => {
    setFileAction('open')
  }, [])

  const copyDocument = useCallback(() => {
    if (documentRef.current && document) setFileAction('copy')
    else
      toast.error(
        'Open a document and wait for it to load before making a copy.',
        { id: 'document-workspace-error' },
      )
  }, [document])

  const downloadDocument = useCallback(async () => {
    try {
      if (!document || !documentRef.current)
        throw new Error(
          'Open a document and wait for it to load before downloading.',
        )
      const source = { name: document.name, doc: documentRef.current }
      await documentSessions.get(document.id)?.recoverAssets()
      await downloadConcept(source.name, source.doc)
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not download the document.',
        { id: 'document-workspace-error' },
      )
    }
  }, [document])

  const exportDocument = useCallback(
    async (format: ExportFormat) => {
      const editor = editorRef.current
      if (!document || !editor) {
        toast.error(
          'Open a document and wait for it to load before exporting.',
          {
            id: 'document-workspace-error',
          },
        )
        return
      }
      try {
        const file = await serializeExport(
          editor,
          document.name,
          format,
          documentSessions.get(document.id)?.assets,
        )
        if (file.notice) toast.info(file.notice)
        downloadExport(document.name, file)
      } catch {
        toast.error('Could not export the document. Please try again.', {
          id: 'document-workspace-error',
        })
      }
    },
    [document],
  )

  const disconnectDrive = useCallback(() => {
    setDriveLoading(true)
    void disconnectGoogleDrive()
      .then(async () => {
        setDriveIds(new Set())
        await Promise.all(
          libraryRef.current.documents
            .filter((item) => item.drive && !item.drive.dirty)
            .map((item) => localDocumentStorage.delete(item.id)),
        )
        if (document?.drive || id?.startsWith('G')) await navigate({ to: '/' })
      })
      .catch((cause: unknown) =>
        toast.error(
          cause instanceof Error
            ? cause.message
            : 'Could not disconnect Google Drive.',
          { id: 'document-workspace-error' },
        ),
      )
      .finally(() => setDriveLoading(false))
  }, [document?.drive, id, navigate])

  const saveToDrive = useCallback(() => setSaveToDriveOpen(true), [])

  const onDriveSaved = useCallback(
    async (savedId: string) => {
      setSaveToDriveOpen(false)
      await navigate({ to: '/', hash: documentHash(savedId) })
      setDriveLoading(true)
      try {
        setDriveIds(await refreshDriveDocuments())
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : 'Could not load Drive documents.',
          { id: 'document-workspace-error' },
        )
      } finally {
        setDriveLoading(false)
      }
    },
    [navigate],
  )

  const syncNow = useCallback(() => {
    void documentSessions.get(document?.id ?? '')?.sync(true)
  }, [document?.id])

  const setOfflineAvailable = useCallback(
    (value: boolean) => {
      if (!document?.id) return
      void setDocumentOfflineAvailable(document.id, value).catch(
        (cause: unknown) =>
          toast.error(
            cause instanceof Error
              ? cause.message
              : 'Could not change offline availability.',
            { id: 'document-workspace-error' },
          ),
      )
    },
    [document?.id],
  )

  const showDetails = useCallback(() => setDetailsOpen(true), [])
  const shareDocument = useCallback(() => setShareOpen(true), [])
  const openPageSetup = useCallback(() => setPageSetupOpen(true), [])
  const importDocument = useCallback((format: ImportFormat) => {
    setFileAction(format)
  }, [])

  const focusEditor = useCallback(() => {
    editorRef.current?.getRootElement()?.focus({ preventScroll: true })
    editorRef.current?.focus()
  }, [])

  const closeFileDialog = useCallback(() => {
    setFileAction(null)
  }, [])

  const documents = useMemo(
    () =>
      library.documents.filter(
        (item) =>
          !item.drive ||
          (driveConnected && (!driveIds || driveIds.has(item.id))) ||
          item.id === document?.id ||
          item.drive.offlineAvailable ||
          item.drive.dirty,
      ),
    [library.documents, driveConnected, driveIds, document?.id],
  )

  const workspace = useMemo(
    () => ({
      document,
      documents,
      loaded: library.loaded,
      error: library.error,
      creating: library.creating,
      createDocument,
      renameDocument,
      renameDocumentById,
      deleteDocument,
      saveStatus,
      driveLoading,
      driveConnected,
      openGoogleDrivePicker,
      pickerLoading,
      disconnectDrive,
      connectionRevision,
      connectDrive,
      saveToDrive,
      saveToDriveOpen,
      onSaveToDriveOpenChange: setSaveToDriveOpen,
      onDriveSaved,
      syncNow,
      setOfflineAvailable,
      enabled: Boolean(document),
      documentRef,
      editorRef,
      cursorsContainerRef,
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
      document,
      documents,
      library.loaded,
      library.error,
      library.creating,
      createDocument,
      renameDocument,
      renameDocumentById,
      deleteDocument,
      saveStatus,
      driveLoading,
      driveConnected,
      openGoogleDrivePicker,
      pickerLoading,
      disconnectDrive,
      connectionRevision,
      connectDrive,
      saveToDrive,
      saveToDriveOpen,
      onDriveSaved,
      syncNow,
      setOfflineAvailable,
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

  return useMemo(
    () => ({ workspace, fileAction, closeFileDialog }),
    [workspace, fileAction, closeFileDialog],
  )
}

export type DocumentWorkspaceState = ReturnType<
  typeof useWorkspaceState
>['workspace']

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
        {workspace.saveToDriveOpen && document && documentRef.current && (
          <SaveToDriveDialog
            source={{ name: document.name, doc: documentRef.current }}
            onClose={() => workspace.onSaveToDriveOpenChange(false)}
            onSaved={(info) => {
              void workspace.onDriveSaved(info.id)
            }}
          />
        )}
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
            onOpenDrive={
              workspace.driveConnected
                ? workspace.openGoogleDrivePicker
                : workspace.connectDrive
            }
            driveConnected={workspace.driveConnected}
            drivePickerDisabled={
              workspace.driveLoading || workspace.pickerLoading
            }
            onClose={closeFileDialog}
          />
        )}
      </Suspense>
    </DocumentWorkspaceContext>
  )
}
