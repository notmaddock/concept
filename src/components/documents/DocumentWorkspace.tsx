import {
  DocumentWorkspaceProvider,
  useDocumentWorkspace,
} from './document-workspace-context'
import { useEffect, useState } from 'react'
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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '#/components/ui/sidebar'
import { DocumentNavigation } from './DocumentNavigation'
import { DocumentList } from './DocumentList'
import { DocumentLoading } from './DocumentLoading'
import { DocumentEditor } from './DocumentEditor'
import { AppToaster } from '#/components/app-toaster'

export function DocumentWorkspace({ id }: { id?: string }) {
  return (
    <DocumentWorkspaceProvider id={id}>
      <AppToaster />
      <DocumentWorkspaceContent id={id} />
    </DocumentWorkspaceProvider>
  )
}

function DocumentWorkspaceContent({ id }: { id?: string }) {
  const {
    documents,
    document,
    loaded,
    error,
    creating,
    createDocument,
    renameDocument,
    renameDocumentById,
    deleteDocument,
    documentRef,
    editorRef,
    pageSetupOpen,
    onPageSetupOpenChange,
  } = useDocumentWorkspace()

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <CloseSidebarOnNavigation id={document?.id} />
      <Sidebar variant="inset">
        <SidebarHeader className="gap-4 p-4">
          <Link
            to="/"
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
            <DocumentList
              documents={documents}
              activeId={document?.id}
              loading={!loaded && !error}
              onRename={renameDocumentById}
              onDelete={deleteDocument}
            />
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
          <DocumentNavigation />
        </header>
        {error && (
          <p role="alert" className="px-6 pb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <main
          aria-label="Document workspace"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-4 [scrollbar-gutter:stable] md:px-6"
        >
          {document ? (
            <div
              data-document-sheet
              className="mx-auto flex min-h-full w-full shrink-0 grow flex-col max-w-[960px] rounded-lg bg-card shadow-sm"
            >
              <DocumentEditor
                key={document.id}
                documentRef={documentRef}
                id={document.id}
                editorRef={editorRef}
                pageSetupOpen={pageSetupOpen}
                onPageSetupOpenChange={onPageSetupOpenChange}
              />
            </div>
          ) : (!loaded || !id) && !error ? (
            <DocumentLoading
              label={id ? 'Opening document…' : 'Loading documents…'}
            />
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
