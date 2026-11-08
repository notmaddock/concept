import { $isAtNodeEnd } from '@lexical/selection'
import type { ElementNode, RangeSelection, TextNode } from 'lexical'
import { $isRangeSelection } from 'lexical'

export function getSelectedNode(
  selection: RangeSelection,
): TextNode | ElementNode
export function getSelectedNode(
  selection?: unknown,
): TextNode | ElementNode | null
export function getSelectedNode(
  selection?: unknown,
): TextNode | ElementNode | null {
  if (!selection || !$isRangeSelection(selection)) return null
  const anchor = selection.anchor
  const focus = selection.focus
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  if (anchorNode === focusNode) {
    return anchorNode
  }
  const isBackward = selection.isBackward()
  if (isBackward) {
    return $isAtNodeEnd(focus) ? anchorNode : focusNode
  } else {
    return $isAtNodeEnd(anchor) ? focusNode : anchorNode
  }
}
