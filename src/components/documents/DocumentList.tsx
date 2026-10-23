import { rememberThemeOrigin } from '#/lib/documents/theme-transition'
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
import { useDocumentListWindow } from './use-document-list-window'

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
  const listWindow = useDocumentListWindow(
    loading ? 0 : documents.length,
    documents.findIndex((item) => item.id === activeId),
  )

  return (
    <>
      {loading && (
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
      )}
      <SidebarMenu
        ref={listWindow.listRef}
        aria-label="Documents"
        aria-busy={loading}
        style={
          listWindow.virtual
            ? {
                position: 'relative',
                height: documents.length * listWindow.rowHeight - 2,
              }
            : undefined
        }
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            listWindow.setFocusedIndex(null)
        }}
        onKeyDown={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-document-index]',
          )
          if (!row || !(event.target instanceof HTMLAnchorElement)) return
          const index = Number(row.dataset.documentIndex)
          let next: number | undefined
          if (event.key === 'ArrowDown')
            next = Math.min(documents.length - 1, index + 1)
          else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = documents.length - 1
          if (next !== undefined) {
            event.preventDefault()
            listWindow.focus(next)
          }
        }}
      >
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
          : listWindow.indexes.map((index) => {
              const item = documents[index]
              return (
                <SidebarMenuItem
                  key={item.id}
                  data-document-index={index}
                  aria-posinset={index + 1}
                  aria-setsize={documents.length}
                  onFocus={() => listWindow.setFocusedIndex(index)}
                  style={
                    listWindow.virtual
                      ? {
                          position: 'absolute',
                          top: index * listWindow.rowHeight,
                          left: 0,
                          right: 0,
                          height: 32,
                        }
                      : undefined
                  }
                >
                  <DocumentContextMenu
                    id={item.id}
                    name={item.name}
                    backedUp={Boolean(item.backing)}
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
                        onClick={(event) => {
                          if (
                            item.id !== activeId &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey
                          )
                            rememberThemeOrigin(event)
                        }}
                        render={<Link to="/d/$id" params={{ id: item.id }} />}
                      >
                        <FileTextIcon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </DocumentDetailsPopover>
                  </DocumentContextMenu>
                </SidebarMenuItem>
              )
            })}
      </SidebarMenu>
      {!loading && documents.length === 0 && emptyMessage && (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </>
  )
}
