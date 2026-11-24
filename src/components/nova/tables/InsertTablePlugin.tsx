import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_EDITOR } from 'lexical'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { updateDocumentEdit } from '../document-edit'
import {
  $captureTableInsertion,
  $insertTable,
  maxTableColumns,
  maxTableRows,
  OPEN_INSERT_TABLE_DIALOG_COMMAND,
} from './table-commands'
import type { TableInsertion } from './table-commands'

export function InsertTablePlugin() {
  const [editor] = useLexicalComposerContext()
  const [target, setTarget] = useState<TableInsertion | null>(null)
  const rowsInput = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_INSERT_TABLE_DIALOG_COMMAND,
        () => {
          if (!editor.isEditable()) return false
          try {
            setTarget($captureTableInsertion())
          } catch (cause) {
            toast.error(
              cause instanceof Error
                ? cause.message
                : 'Could not insert a table.',
            )
          }
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) setTarget(null)
      }}
    >
      {target && (
        <DialogContent
          aria-describedby={undefined}
          initialFocus={rowsInput}
          finalFocus={() => editor.getRootElement()}
        >
          <DialogHeader>
            <DialogTitle>Insert table</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              if (!editor.isEditable()) return
              updateDocumentEdit(editor, () => {
                try {
                  $insertTable(
                    target,
                    Number(data.get('rows')),
                    Number(data.get('columns')),
                    data.has('header'),
                  )
                  setTarget(null)
                } catch (cause) {
                  toast.error(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not insert the table.',
                  )
                }
              })
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-2 font-medium">
                Rows
                <Input
                  ref={rowsInput}
                  name="rows"
                  type="number"
                  min={1}
                  max={maxTableRows}
                  defaultValue={3}
                  required
                />
              </label>
              <label className="grid gap-2 font-medium">
                Columns
                <Input
                  name="columns"
                  type="number"
                  min={1}
                  max={maxTableColumns}
                  defaultValue={3}
                  required
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <Checkbox name="header" aria-label="Header row" defaultChecked />
              Header row
            </label>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit">Insert table</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}
