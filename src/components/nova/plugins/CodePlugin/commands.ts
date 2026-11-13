import { $createCodeNode, $isCodeNode } from '@lexical/code'
import { $setBlocksType } from '@lexical/selection'
import {
  $createParagraphNode,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
} from 'lexical'
import type { LexicalEditor } from 'lexical'

export function $insertCodeBlock() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return

  if (selection.isCollapsed()) {
    $setBlocksType(selection, () => $createCodeNode())
    return
  }

  const textContent = selection.getTextContent()
  selection.insertNodes([$createCodeNode()])
  selection.insertRawText(textContent)
}

export function insertCodeBlock(editor: LexicalEditor) {
  editor.update(() => $insertCodeBlock())
}

export function $exitCodeBlockOnEnter() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const { anchor } = selection
  if (anchor.type !== 'element') return false

  const codeNode = anchor.getNode()
  if (!$isCodeNode(codeNode)) return false

  const childrenSize = codeNode.getChildrenSize()
  if (anchor.offset !== childrenSize || childrenSize < 2) return false

  const lastChild = codeNode.getLastChild()
  if (
    !$isLineBreakNode(lastChild) ||
    !$isLineBreakNode(lastChild.getPreviousSibling())
  )
    return false

  const paragraph = $createParagraphNode()
  codeNode.splice(childrenSize - 2, 2, [])
  codeNode.insertAfter(paragraph, false)
  paragraph.select()
  return true
}
