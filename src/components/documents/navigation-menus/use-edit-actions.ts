import { useEffect, useState } from 'react'
import {
  $selectAll,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  HISTORY_PUSH_TAG,
  PASTE_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { $clearSelectionFormatting } from './use-format-actions'
import { isMac } from './ActionShortcut'

export type EditAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-plain'
  | 'select-all'
  | 'delete-selection'
  | 'clear-formatting'

export function useEditActions(
  editorRef: RefObject<LexicalEditor | null>,
  documentId: string | undefined,
  onError: (message: string) => void,
) {
  const [state, setState] = useState({
    ready: false,
    editable: false,
    selection: false,
    range: false,
    undo: false,
    redo: false,
  })

  useEffect(() => {
    let frame = 0
    let cleanups: (() => void)[] = []
    setState({
      ready: false,
      editable: false,
      selection: false,
      range: false,
      undo: false,
      redo: false,
    })
    function connect() {
      const editor = editorRef.current
      if (!editor) {
        frame = requestAnimationFrame(connect)
        return
      }
      const update = () => {
        const snapshot = editor.getEditorState().read(() => {
          const selection = $getSelection()
          const range = $isRangeSelection(selection) && !selection.isCollapsed()
          return {
            ready: true,
            editable: editor.isEditable(),
            range,
            selection:
              range ||
              ($isNodeSelection(selection) && selection.getNodes().length > 0),
          }
        })
        setState((previous) => {
          if (
            Object.entries(snapshot).every(
              ([key, value]) =>
                previous[key as keyof typeof snapshot] === value,
            )
          )
            return previous
          return { ...previous, ...snapshot }
        })
      }
      update()
      cleanups = [
        editor.registerUpdateListener(update),
        editor.registerEditableListener(update),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (undo) => {
            setState((previous) => ({ ...previous, undo }))
            return false
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (redo) => {
            setState((previous) => ({ ...previous, redo }))
            return false
          },
          COMMAND_PRIORITY_LOW,
        ),
      ]
    }
    if (documentId) connect()
    return () => {
      cancelAnimationFrame(frame)
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [editorRef, documentId])

  function disabled(action: EditAction) {
    if (!state.ready) return true
    if (action === 'copy') return !state.selection
    if (action === 'select-all') return false
    if (!state.editable) return true
    if (action === 'undo' || action === 'redo') return !state[action]
    if (action === 'clear-formatting') return !state.range
    if (action === 'cut' || action === 'delete-selection')
      return !state.selection
    return false
  }

  async function run(action: EditAction) {
    const editor = editorRef.current
    if (!editor || disabled(action)) return
    // Let the menu finish closing before restoring the editor selection.
    await Promise.resolve()
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.focus()
    try {
      if (action === 'undo' || action === 'redo') {
        editor.dispatchCommand(
          action === 'undo' ? UNDO_COMMAND : REDO_COMMAND,
          undefined,
        )
      } else if (action === 'cut' || action === 'copy') {
        // The native command reports failure and only cuts after copying succeeds.
        if (!document.execCommand(action))
          throw new Error('Clipboard access denied')
      } else if (action === 'paste' || action === 'paste-plain') {
        const data = new DataTransfer()
        if (action === 'paste-plain') {
          data.setData('text/plain', await navigator.clipboard.readText())
        } else {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            for (const type of item.types) {
              const blob = await item.getType(type)
              if (type === 'text/plain' || type === 'text/html')
                data.setData(type, await blob.text())
              else if (type.startsWith('image/'))
                data.items.add(new File([blob], 'clipboard-image', { type }))
            }
          }
        }
        editor.getRootElement()?.focus({ preventScroll: true })
        editor.focus()
        if (action === 'paste-plain') {
          editor.update(
            () => {
              const selection = $getSelection()
              if ($isRangeSelection(selection)) {
                selection.removeText()
                selection.format = 0
                selection.style = ''
                selection.insertRawText(data.getData('text/plain'))
              }
            },
            { tag: HISTORY_PUSH_TAG },
          )
        } else {
          editor.dispatchCommand(
            PASTE_COMMAND,
            new ClipboardEvent('paste', { clipboardData: data }),
          )
        }
      } else {
        editor.update(
          () => {
            if (action === 'select-all') {
              $selectAll()
              return
            }
            const selection = $getSelection()
            if (action === 'delete-selection') {
              if ($isRangeSelection(selection)) selection.removeText()
              else if ($isNodeSelection(selection))
                selection.getNodes().forEach((node) => node.remove())
            } else {
              $clearSelectionFormatting()
            }
          },
          { tag: HISTORY_PUSH_TAG },
        )
      }
    } catch {
      const modifier = isMac() ? '⌘' : 'Ctrl+'
      const shortcut =
        action === 'copy'
          ? `${modifier}C`
          : action === 'cut'
            ? `${modifier}X`
            : action === 'paste-plain'
              ? `${modifier}Shift+V`
              : `${modifier}V`
      onError(
        `Could not access the clipboard. Use ${shortcut} in the editor instead.`,
      )
    }
  }

  return { run, disabled }
}
