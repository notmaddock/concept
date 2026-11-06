import {
  $caretFromPoint,
  $createParagraphNode,
  $getSelection,
  $insertNodeToNearestRootAtCaret,
  $isElementNode,
  $isRangeSelection,
} from 'lexical'
import type { LexicalNode } from 'lexical'

export function $insertImageBlocks(nodes: LexicalNode[]) {
  if (!nodes.length) return
  const selection = $getSelection()
  if (!$isRangeSelection(selection))
    throw new Error('Choose a text position for the image.')
  selection.removeText()
  $insertNodeToNearestRootAtCaret(
    nodes[0],
    $caretFromPoint(selection.anchor, 'next'),
  )
  let last = nodes[0]
  for (const node of nodes.slice(1)) {
    last.insertAfter(node)
    last = node
  }
  let next = last.getNextSibling()
  if (!$isElementNode(next)) {
    next = $createParagraphNode()
    last.insertAfter(next)
  }
  if ($isElementNode(next)) next.selectStart()
}
