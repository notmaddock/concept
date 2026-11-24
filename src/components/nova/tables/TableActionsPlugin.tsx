import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, mergeRegister } from 'lexical'
import { ChevronDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { $applyTableAction, $getTableActionTarget } from './table-actions'
import type { TableAction, TableActionTarget } from './table-actions'
import { updateDocumentEdit } from '../document-edit'

function sameTarget(
  first: TableActionTarget | null,
  second: TableActionTarget | null,
) {
  return (
    first === second ||
    (first?.cellKey === second?.cellKey &&
      first?.anchorKey === second?.anchorKey &&
      first?.tableKey === second?.tableKey &&
      first?.headerRow === second?.headerRow &&
      first?.headerColumn === second?.headerColumn &&
      first?.mergedCell === second?.mergedCell)
  )
}

const insertionActions = [
  ['row-before', 'Insert row above'],
  ['row-after', 'Insert row below'],
  ['column-before', 'Insert column before'],
  ['column-after', 'Insert column after'],
] as const

const deletionActions = [
  ['delete-row', 'Delete selected rows'],
  ['delete-column', 'Delete selected columns'],
  ['delete-table', 'Delete table'],
] as const

export function TableActionsPlugin() {
  const [editor] = useLexicalComposerContext()
  const overlayRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<TableActionTarget | null>(null)
  const [menuTarget, setMenuTarget] = useState<TableActionTarget | null>(null)
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const visibleTarget = menuTarget ?? target
  const cellKey = visibleTarget?.cellKey
  const tableKey = visibleTarget?.tableKey

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          const next = editorState.read($getTableActionTarget)
          setTarget((previous) =>
            sameTarget(previous, next) ? previous : next,
          )
        }),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            if (
              event.defaultPrevented ||
              event.isComposing ||
              (event.key !== 'ContextMenu' &&
                !(event.shiftKey && event.key === 'F10'))
            )
              return false
            const next = $getTableActionTarget()
            if (!next || !editor.isEditable()) return false
            event.preventDefault()
            setMenuTarget(next)
            setTarget(next)
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  )

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const view = overlay?.ownerDocument.defaultView
    if (!overlay || !cellKey || !tableKey || !view) return

    let observedCell: HTMLElement | null = null
    const place = () => {
      const cell = editor.getElementByKey(cellKey)
      const table = editor.getElementByKey(tableKey)
      if (cell !== observedCell) {
        if (observedCell) resize?.unobserve(observedCell)
        if (cell) resize?.observe(cell)
        observedCell = cell
      }
      if (!cell || !table) {
        setPosition(null)
        setMenuTarget(null)
        return
      }
      const area = overlay.getBoundingClientRect()
      const bounds = cell.getBoundingClientRect()
      const scroll = table.getBoundingClientRect()
      const right = Math.min(bounds.right, scroll.right)
      const left = Math.max(bounds.left, scroll.left)
      if (right - left < 28) {
        setPosition(null)
        setMenuTarget(null)
        return
      }
      const next = {
        top: bounds.top - area.top + 2,
        left: right - area.left - 26,
      }
      setPosition((previous) =>
        previous?.top === next.top && previous.left === next.left
          ? previous
          : next,
      )
    }

    const resize =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    resize?.observe(overlay)
    place()
    view.addEventListener('scroll', place, true)
    view.addEventListener('resize', place)
    const unregister = editor.registerUpdateListener(place)
    return () => {
      resize?.disconnect()
      view.removeEventListener('scroll', place, true)
      view.removeEventListener('resize', place)
      unregister()
    }
  }, [cellKey, editor, tableKey])

  const run = (action: TableAction) => {
    if (!menuTarget || !editor.isEditable()) return
    updateDocumentEdit(editor, () => {
      try {
        $applyTableAction(action, menuTarget)
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : 'Could not edit the table.',
        )
      }
    })
  }

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0">
      {visibleTarget && position && (
        <div className="absolute z-[2]" style={position}>
          <DropdownMenu
            open={Boolean(menuTarget)}
            modal={false}
            onOpenChange={(nextOpen) => {
              setMenuTarget(nextOpen ? target : null)
            }}
          >
            <DropdownMenuTrigger
              aria-label="Table actions"
              title="Table actions (Shift+F10)"
              onMouseDown={(event) => event.preventDefault()}
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  className="pointer-events-auto rounded-md border-border bg-background text-foreground shadow-sm dark:bg-background"
                />
              }
            >
              <ChevronDownIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="pointer-events-auto w-52"
              finalFocus={() => editor.getRootElement()}
            >
              {insertionActions.map(([action, label]) => (
                <DropdownMenuItem key={action} onClick={() => run(action)}>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={visibleTarget.headerRow}
                closeOnClick
                onClick={() => run('header-row')}
              >
                Header row
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleTarget.headerColumn}
                closeOnClick
                onClick={() => run('header-column')}
              >
                Header column
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                disabled={visibleTarget.anchorKey === visibleTarget.cellKey}
                onClick={() => run('merge')}
              >
                Merge selected cells
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  !visibleTarget.mergedCell ||
                  visibleTarget.anchorKey !== visibleTarget.cellKey
                }
                onClick={() => run('split')}
              >
                Split cell
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {deletionActions.map(([action, label]) => (
                <DropdownMenuItem
                  key={action}
                  variant="destructive"
                  onClick={() => run(action)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
