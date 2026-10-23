import {
  applyDocumentTheme,
  resetDocumentTheme,
} from '#/lib/documents/theme-transition'
import { AccountManager } from '#/components/account/AccountManager'
import {
  DocumentWorkspaceProvider,
  useDocumentWorkspace,
} from './document-workspace-context'
import { lazy, Suspense, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { FileTextIcon, PlusIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DocumentName } from './DocumentName'
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

const loadEditor = () => import('./DocumentEditor')
const DocumentEditor = lazy(() =>
  loadEditor().then((module) => ({ default: module.DocumentEditor })),
)

export function DocumentWorkspace({ id }: { id?: string }) {
  useEffect(() => resetDocumentTheme, [])
  useEffect(() => {
    if (id) void loadEditor().catch(() => {})
  }, [id])
  return (
    <DocumentWorkspaceProvider id={id}>
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
    onDocumentThemeChange,
    editorRef,
    pageSetupOpen,
    onPageSetupOpenChange,
  } = useDocumentWorkspace()

  useEffect(() => {
    if (loaded && !document) applyDocumentTheme('default')
  }, [loaded, document])

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
            <DocumentList
              documents={documents}
              activeId={id}
              loading={!loaded && !error}
              onRename={renameDocumentById}
              onDelete={deleteDocument}
            />
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
        <header className="z-10 flex shrink-0 items-center gap-3 px-4 py-1.5 md:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <DocumentName
                key={document ? `${document.id}:${document.name}` : 'library'}
                name={document?.name ?? 'Documents'}
                onSave={document ? renameDocument : undefined}
              />
            </div>
            <DocumentNavigation />
          </div>
          <AccountManager />
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
              <Suspense fallback={<DocumentLoading />}>
                <DocumentEditor
                  key={document.id}
                  documentRef={documentRef}
                  onDocumentThemeChange={onDocumentThemeChange}
                  id={document.id}
                  editorRef={editorRef}
                  pageSetupOpen={pageSetupOpen}
                  onPageSetupOpenChange={onPageSetupOpenChange}
                />
              </Suspense>
            </div>
          ) : !loaded && !error ? (
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

function CloseSidebarOnNavigation({ id }: { id?: string }) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [id, setOpenMobile])
  return null
}
