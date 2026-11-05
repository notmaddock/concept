import {
  documentMenuContentClassName,
  documentMenuItemClassName,
} from './navigation-menus/menu-styles'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RenameDocumentDialog } from './dialogs/RenameDocumentDialog'
import { documentHash } from '#/lib/documents/document-url'
import { ExternalLinkIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '#/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'

export function DocumentContextMenu({
  children,
  id,
  name,
  onRename,
  onDelete,
}: {
  id: string
  onRename?: (name: string) => Promise<boolean>
  children: ReactNode
  name: string
  onDelete: () => Promise<void>
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await onDelete()
      setConfirming(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
        <ContextMenuContent className={documentMenuContentClassName}>
          <ContextMenuItem
            className={documentMenuItemClassName}
            render={
              <Link
                to="/"
                hash={documentHash(id)}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <ExternalLinkIcon /> Open in new tab
          </ContextMenuItem>
          {onRename && (
            <ContextMenuItem
              className={documentMenuItemClassName}
              onClick={() => setRenaming(true)}
            >
              <PencilIcon /> Rename
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            className={documentMenuItemClassName}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon /> Delete document
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {renaming && onRename && (
        <RenameDocumentDialog
          name={name}
          onRename={onRename}
          onClose={() => setRenaming(false)}
        />
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              “{name}” will be removed from your documents. Are you sure you
              want to delete it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting ? 'Deleting…' : 'Delete document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
