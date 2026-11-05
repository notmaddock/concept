import { HISTORY_PUSH_TAG } from 'lexical'
import type { EditorUpdateOptions, LexicalEditor } from 'lexical'
import type { UndoManager } from 'yjs'

export function updateImageEdit(
  editor: LexicalEditor,
  update: () => void,
  options: EditorUpdateOptions = {},
) {
  // The collaboration plugin publishes this well-known key for explicit
  // undo boundaries; Lexical's history tag only controls standalone history.
  const manager = (
    editor as LexicalEditor & Record<symbol, UndoManager | undefined>
  )[Symbol.for('@lexical/yjs/UndoManager')]
  manager?.stopCapturing()
  try {
    editor.update(update, {
      tag: HISTORY_PUSH_TAG,
      ...options,
      discrete: true,
      onUpdate: () => {
        manager?.stopCapturing()
        options.onUpdate?.()
      },
    })
  } finally {
    manager?.stopCapturing()
  }
}
