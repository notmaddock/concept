import { Link } from '@tanstack/react-router'
import { FileTextIcon } from 'lucide-react'
import type { DocumentInfo } from '#/lib/documents/storage'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar'
import { Skeleton } from '#/components/ui/skeleton'
import { DocumentContextMenu } from './DocumentContextMenu'
import { DocumentDetailsPopover } from './DocumentDetailsPopover'

const placeholderWidths = ['70%', '85%', '55%', '75%', '60%']

export function DocumentList({
  documents,
  activeId,
  loading = false,
  loadingLabel = 'Loading documents…',
  emptyMessage,
  onDelete,
  onRename,
}: {
  documents: Array<DocumentInfo>
  activeId?: string
  loading?: boolean
  loadingLabel?: string
  emptyMessage?: string
  onRename?: (id: string, name: string) => Promise<boolean>
  onDelete: (id: string) => void | Promise<void>
}) {
  return (
    <>
      {loading && (
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
      )}
      <SidebarMenu aria-label="Documents" aria-busy={loading}>
        {loading
          ? placeholderWidths.map((width) => (
              <SidebarMenuItem key={width} aria-hidden="true">
                <div className="flex h-8 items-center gap-2 px-2">
                  <Skeleton className="size-4 shrink-0 rounded-sm motion-reduce:animate-none" />
                  <Skeleton
                    className="h-4 rounded-sm motion-reduce:animate-none"
                    style={{ width }}
                  />
                </div>
              </SidebarMenuItem>
            ))
          : documents.map((item) => (
              <SidebarMenuItem key={item.id}>
                <DocumentContextMenu
                  id={item.id}
                  name={item.name}
                  onRename={
                    onRename ? (name) => onRename(item.id, name) : undefined
                  }
                  onDelete={async () => {
                    await onDelete(item.id)
                  }}
                >
                  <DocumentDetailsPopover document={item}>
                    <SidebarMenuButton
                      isActive={item.id === activeId}
                      render={<Link to="/d/$id" params={{ id: item.id }} />}
                    >
                      <FileTextIcon />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                  </DocumentDetailsPopover>
                </DocumentContextMenu>
              </SidebarMenuItem>
            ))}
      </SidebarMenu>
      {!loading && documents.length === 0 && emptyMessage && (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </>
  )
}
