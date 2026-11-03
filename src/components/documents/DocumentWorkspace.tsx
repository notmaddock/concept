import {
  DocumentWorkspaceProvider,
  useDocumentWorkspace,
} from './document-workspace-context'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  FileTextIcon,
  PlusIcon,
  LoaderCircleIcon,
  Settings2Icon,
} from 'lucide-react'
import { DocumentSaveStatus } from './DocumentSaveStatus'
import { ProvidersDialog } from './ProvidersDialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
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
    saveStatus,
    driveLoading,
    driveError,
    driveConnected,
    connectDrive,
    disconnectDrive,
    saveToDrive,
    syncNow,
    setOfflineAvailable,
    connectionRevision,
  } = useDocumentWorkspace()
  const [providersOpen, setProvidersOpen] = useState(false)

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
            <SidebarGroupLabel>
              Documents
              {(!loaded || driveLoading) && (
                <LoaderCircleIcon
                  aria-label="Loading document sources"
                  className="ml-2 size-3 animate-spin"
                />
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <DocumentList
                documents={documents}
                activeId={document?.id}
                loading={!loaded && !error}
                onRename={renameDocumentById}
                onDelete={deleteDocument}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setProvidersOpen(true)}
                tooltip="Manage providers"
              >
                <Settings2Icon />
                <span>Manage providers</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <ProvidersDialog
        open={providersOpen}
        onOpenChange={setProvidersOpen}
        connected={driveConnected}
        loading={driveLoading}
        error={driveError}
        onConnect={connectDrive}
        onDisconnect={disconnectDrive}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
        <header className="z-10 shrink-0 px-4 py-1.5 md:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <DocumentName
              key={document ? `${document.id}:${document.name}` : 'library'}
              name={document?.name ?? 'Documents'}
              onSave={document ? renameDocument : undefined}
            />
            {document && (
              <DocumentSaveStatus
                status={saveStatus}
                provider={document.drive ? 'google-drive' : undefined}
                onRetry={syncNow}
                onConnect={() => {
                  void connectDrive()
                }}
                onSaveToDrive={saveToDrive}
                onOfflineChange={
                  document.drive ? setOfflineAvailable : undefined
                }
              />
            )}
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
                key={`${document.id}:${connectionRevision}`}
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
      size={Math.max(1, value.length)}
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
      className="h-8 w-auto min-w-0 max-w-[min(28rem,calc(100vw-9rem))] [field-sizing:content] border-transparent bg-transparent text-lg! shadow-none hover:border-input focus-visible:bg-background read-only:pointer-events-none"
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
