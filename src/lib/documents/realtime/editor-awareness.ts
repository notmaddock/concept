import { $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import type { LexicalEditor, PointType, RangeSelection } from 'lexical'
import type { RealtimeProvider } from './realtime'

export interface SelectionAwareness {
  presence: true
  /** Global character offsets of the range selection, or null for a caret/blur. */
  selection: { anchor: number; focus: number } | null
}

/** Global character offset of a Lexical point within the root text content. */
function pointOffset(point: PointType): number {
  const root = $getRoot()
  if (point.type === 'text') {
    let offset = 0
    for (const node of root.getAllTextNodes()) {
      if (node.getKey() === point.key) return offset + point.offset
      offset += node.getTextContentSize()
    }
    return offset
  }
  let offset = 0
  const children = root.getChildren()
  const limit = Math.min(point.offset, children.length)
  for (let index = 0; index < limit; index++)
    offset += children[index].getTextContentSize()
  return offset
}

export function selectionAwareness(
  selection: RangeSelection | null,
): SelectionAwareness {
  return {
    presence: true,
    selection: selection
      ? {
          anchor: pointOffset(selection.anchor),
          focus: pointOffset(selection.focus),
        }
      : null,
  }
}

/**
 * Bridges Lexical selection changes into the realtime provider's awareness so
 * presence/cursor updates flow over the socket. Returns a cleanup function.
 */
export function attachEditorAwareness(
  editor: LexicalEditor,
  getProvider: () => RealtimeProvider | undefined,
): () => void {
  let last: string | undefined
  const publish = () => {
    const provider = getProvider()
    if (!provider) return
    const state = editor.getEditorState().read(() => {
      const selection = $getSelection()
      return selectionAwareness($isRangeSelection(selection) ? selection : null)
    })
    const serialized = JSON.stringify(state)
    if (serialized === last) return
    last = serialized
    provider.awareness.setLocalState(state)
  }
  return editor.registerUpdateListener(publish)
}
