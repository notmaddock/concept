import { useSyncExternalStore } from 'react'
import type { EditorState, LexicalEditor } from 'lexical'
import { $readOutline, nestOutline } from './outline'
import type { OutlineHeading, OutlineItem } from './outline'

const emptyOutline: OutlineItem[] = []
const getServerSnapshot = () => emptyOutline

function createOutlineStore(editor: LexicalEditor) {
  let lastState: EditorState | undefined
  let headings: readonly OutlineHeading[] = []
  let outline = emptyOutline
  let unregister: (() => void) | undefined
  const listeners = new Set<() => void>()

  function refresh(state: EditorState) {
    lastState = state
    const next = state.read($readOutline)
    if (
      next.length === headings.length &&
      next.every(
        (item, index) =>
          item.key === headings[index].key &&
          item.text === headings[index].text &&
          item.level === headings[index].level,
      )
    ) {
      return false
    }
    headings = next
    outline = nestOutline(next)
    return true
  }

  return {
    getSnapshot: () => {
      const state = editor.getEditorState()
      if (state !== lastState) refresh(state)
      return outline
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      unregister ??= editor.registerUpdateListener(
        ({ editorState, dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size || dirtyLeaves.size) {
            if (refresh(editorState)) {
              for (const notify of listeners) notify()
            }
          } else {
            lastState = editorState
          }
        },
      )
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unregister?.()
        unregister = undefined
      }
    },
  }
}

const stores = new WeakMap<
  LexicalEditor,
  ReturnType<typeof createOutlineStore>
>()

export function useOutline(editor: LexicalEditor) {
  let store = stores.get(editor)
  if (!store) {
    store = createOutlineStore(editor)
    stores.set(editor, store)
  }
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot,
  )
}
