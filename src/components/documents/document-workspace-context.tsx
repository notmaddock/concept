import { createContext, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import { useDocuments } from '#/hooks/use-documents'
import { downloadConcept } from '#/lib/documents/concept-file'
import { DocumentStorageDialog } from './DocumentStorageDialog'
import { DocumentShareDialog } from './DocumentShareDialog'

function useWorkspaceState(id?: string) {
  const library = useDocuments(id)
  const { document } = library
  const documentRef = useRef<Doc | null>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const [fileAction, setFileAction] = useState<'open' | 'copy' | null>(null)
  const [fileError, setFileError] = useState('')
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

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

  function downloadDocument() {
    try {
      if (!document || !documentRef.current)
        throw new Error(
          'Open a document and wait for it to load before downloading.',
        )
      downloadConcept(document.name, documentRef.current)
      setFileError('')
    } catch (cause) {
      setFileError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the document.',
      )
    }
  }

  const workspace = {
    ...library,
    error: library.error || fileError,
    enabled: Boolean(document),
    documentRef,
    editorRef,
    shareOpen,
    onShareOpenChange: setShareOpen,
    shareDocument: () => setShareOpen(true),
    pageSetupOpen,
    onPageSetupOpenChange: setPageSetupOpen,
    openDocument,
    copyDocument,
    downloadDocument,
    openPageSetup: () => setPageSetupOpen(true),
    focusEditor: () => editorRef.current?.focus(),
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

  return (
    <DocumentWorkspaceContext value={workspace}>
      {children}
      <DocumentShareDialog
        open={workspace.shareOpen}
        onOpenChange={workspace.onShareOpenChange}
        onCopy={workspace.copyDocument}
      />
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
