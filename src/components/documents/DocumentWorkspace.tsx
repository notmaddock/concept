import { useEffect, useRef, useState } from 'react'
import type { Doc } from 'yjs'
import { downloadConcept } from '#/lib/documents/concept-file'
import { DocumentStorageDialog } from './DocumentStorageDialog'
import type { LexicalEditor } from 'lexical'
import { Link } from '@tanstack/react-router'
import { FileTextIcon, PlusIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '#/components/ui/sidebar'
import { useDocuments } from '#/hooks/use-documents'
import { DocumentNavigation } from './DocumentNavigation'
import { DocumentContextMenu } from './DocumentContextMenu'
import { DocumentEditor } from './DocumentEditor'

export function DocumentWorkspace({ id }: { id?: string }) {
  const documentRef = useRef<Doc | null>(null)
  const [fileAction, setFileAction] = useState<'open' | 'copy' | null>(null)
  const [fileError, setFileError] = useState('')
  const editorRef = useRef<LexicalEditor | null>(null)
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const {
    documents,
    document,
    loaded,
    error,
    creating,
    createDocument,
    renameDocument,
    deleteDocument,
  } = useDocuments(id)

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <CloseSidebarOnNavigation id={id} />
      <Sidebar variant="inset">
        <SidebarHeader className="gap-4 p-4">
          <Link
            to="/d"
            className="flex items-center gap-2 px-2 py-1 font-semibold"
          >
            <FileTextIcon className="size-5" /> Concept
          </Link>
          <Button onClick={createDocument} disabled={creating}>
            <PlusIcon /> New document
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Documents</SidebarGroupLabel>
            <SidebarMenu>
              {documents.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <DocumentContextMenu
                    name={item.name}
                    onDelete={() => deleteDocument(item.id)}
                  >
                    <SidebarMenuButton
                      isActive={item.id === id}
                      render={<Link to="/d/$id" params={{ id: item.id }} />}
                    >
                      <FileTextIcon />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                  </DocumentContextMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
        <header className="z-10 shrink-0 px-4 py-1.5 md:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <DocumentName
              key={document ? `${document.id}:${document.name}` : 'library'}
              name={document?.name ?? 'Documents'}
              onSave={document ? renameDocument : undefined}
            />
          </div>
          <DocumentNavigation
            onOpen={() => setFileAction('open')}
            onCopy={() => {
              if (documentRef.current && document) setFileAction('copy')
              else
                setFileError(
                  'Open a document and wait for it to load before making a copy.',
                )
            }}
            onDownload={() => {
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
            }}
            onPageSetup={() => setPageSetupOpen(true)}
            onCreate={createDocument}
            creating={creating}
            enabled={Boolean(document)}
            onFocusEditor={() => editorRef.current?.focus()}
          />
        </header>
        {(error || fileError) && (
          <p role="alert" className="px-6 pb-3 text-sm text-destructive">
            {error || fileError}
          </p>
        )}
        <main
          aria-label="Document workspace"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 md:px-6"
        >
          {document ? (
            <div
              data-document-sheet
              className="mx-auto min-h-full w-full max-w-[960px] rounded-lg bg-card shadow-sm"
            >
              <DocumentEditor
                key={document.id}
                documentRef={documentRef}
                id={document.id}
                editorRef={editorRef}
                pageSetupOpen={pageSetupOpen}
                onPageSetupOpenChange={setPageSetupOpen}
              />
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-4 rounded-xl bg-card p-8 text-center">
              <FileTextIcon className="size-10 text-muted-foreground" />
              <h2 className="text-2xl font-medium">
                {!loaded
                  ? 'Loading documents…'
                  : id
                    ? 'Document not found'
                    : 'What would you like to write?'}
              </h2>
              <p className="max-w-sm text-muted-foreground">
                {!loaded
                  ? 'Opening your local library.'
                  : id
                    ? 'This document is not available in this browser.'
                    : 'Choose a document from the sidebar, or start something new.'}
              </p>
              <Button onClick={createDocument} disabled={creating}>
                <PlusIcon /> New document
              </Button>
            </div>
          )}
        </main>
      </div>
      {fileAction && (
        <DocumentStorageDialog
          key={fileAction}
          mode={fileAction}
          source={
            document && documentRef.current
              ? { name: document.name, doc: documentRef.current }
              : undefined
          }
          onClose={() => setFileAction(null)}
        />
      )}
    </SidebarProvider>
  )
}

function DocumentName({
  name,
  onSave,
}: {
  name: string
  onSave?: (name: string) => Promise<void>
}) {
  const [value, setValue] = useState(name)
  return (
    <Input
      aria-label={onSave ? 'Document name' : 'Workspace name'}
      readOnly={!onSave}
      tabIndex={onSave ? 0 : -1}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        void onSave?.(value)
      }}
      onKeyDown={(event) => {
        if (!onSave) return
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setValue(name)
          event.preventDefault()
        }
      }}
      className="h-8 w-full max-w-md border-transparent bg-transparent text-lg! shadow-none hover:border-input focus-visible:bg-background read-only:pointer-events-none"
    />
  )
}

function CloseSidebarOnNavigation({ id }: { id?: string }) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [id, setOpenMobile])
  return null
}
