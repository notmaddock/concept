import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $setSelection,
} from 'lexical'
import type { BaseSelection, LexicalEditor, NodeKey } from 'lexical'

export interface ImageBookmark {
  selection: BaseSelection
  anchors: Array<{ key: NodeKey; text: string; size: number }>
}

// Live keys tolerate caret movement; changed anchors cancel rather than replacing
// text that was edited while the picker or clipboard was preparing bytes.
export function captureImageBookmark(
  editor: LexicalEditor,
): ImageBookmark | null {
  return editor.read('pending', () => {
    const selection = $getSelection()
    if (!selection) return null
    const keys = $isRangeSelection(selection)
      ? [
          selection.anchor.key,
          selection.focus.key,
          ...selection.getNodes().map((node) => node.getKey()),
        ]
      : selection.getNodes().map((node) => node.getKey())
    return {
      selection: selection.clone(),
      anchors: [...new Set(keys)].map((key) => {
        const node = $getNodeByKey(key)!
        return {
          key,
          text: node.getTextContent(),
          size: $isElementNode(node) ? node.getChildrenSize() : 0,
        }
      }),
    }
  })
}

export function restoreImageBookmark(bookmark: ImageBookmark): void {
  for (const anchor of bookmark.anchors) {
    const node = $getNodeByKey(anchor.key)
    if (
      !node?.isAttached() ||
      node.getTextContent() !== anchor.text ||
      ($isElementNode(node) && node.getChildrenSize() !== anchor.size)
    )
      throw new Error(
        'The insertion target changed. Choose a position and try again.',
      )
  }
  $setSelection(bookmark.selection.clone())
}
