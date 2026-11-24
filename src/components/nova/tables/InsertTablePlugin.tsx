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
import { updateDocumentEdit } from '../document-edit'
import { OPEN_INSERT_TABLE_DIALOG_COMMAND } from './commands'
import { $captureTableInsertion, $insertTable } from './table-commands'
import type { TableInsertion } from './table-commands'
import { TableDimensionsPicker } from './TableDimensionsPicker'

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
            <TableDimensionsPicker rowsInput={rowsInput} />
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
