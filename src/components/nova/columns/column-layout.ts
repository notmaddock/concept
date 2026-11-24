import { $isCodeNode } from '@lexical/code'
import { $isListNode } from '@lexical/list'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $createParagraphNode,
  $findMatchingParent,
  $getNearestRootOrShadowRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  defineExtension,
  DELETE_CHARACTER_COMMAND,
  KEY_TAB_COMMAND,
  mergeRegister,
} from 'lexical'
import type {
  ElementNode,
  LexicalNode,
  PointType,
  RangeSelection,
} from 'lexical'
import { toast } from 'sonner'
import { $isPageBreakNode } from '../pages/PageBreakNode'
import { $isPageContentNode } from '../pages/PageContentNode'
import { $isValidRange } from '../utils/selection'
import { updateDocumentEdit } from '../document-edit'
import { SET_COLUMN_LAYOUT_COMMAND } from './commands'
import type { ColumnCount } from './commands'
import {
  $createColumnLayoutNode,
  $createColumnNode,
  $isColumnLayoutNode,
  $isColumnNode,
  ColumnLayoutNode,
  ColumnNode,
} from './ColumnLayoutNode'

function $isDocumentContainer(node: LexicalNode | null): node is ElementNode {
  return $isRootNode(node) || $isPageContentNode(node)
}

function $blocksInLayout(layout: ColumnLayoutNode) {
  return layout
    .getChildren()
    .flatMap((node) => ($isColumnNode(node) ? node.getChildren() : [node]))
}

function $unwrapLayout(layout: ColumnLayoutNode) {
  const parent = layout.getParentOrThrow()
  const blocks = $blocksInLayout(layout)
  parent.splice(layout.getIndexWithinParent(), 1, blocks)
  return blocks.at(0)
}

function $mergeColumns(target: ColumnNode, columns: ColumnNode[]) {
  for (const column of columns) {
    target.append(...column.getChildren())
    column.remove()
  }
}

function $normalizeLayout(layout: ColumnLayoutNode) {
  if (!$isDocumentContainer(layout.getParent())) {
    $unwrapLayout(layout)
    return
  }

  const columns = layout.getChildren().map((node) => {
    if ($isColumnNode(node)) return node
    const column = $createColumnNode()
    node.insertBefore(column)
    column.splice(0, 1, [node])
    return column
  })
  for (let index = columns.length; index < 2; index++) {
    layout.append($createColumnNode())
  }
  if (columns.length > 3) $mergeColumns(columns[2], columns.slice(3))
}

function $normalizeColumn(column: ColumnNode) {
  const parent = column.getParent()
  if (!parent) return
  if (!$isColumnLayoutNode(parent)) {
    parent.splice(column.getIndexWithinParent(), 1, column.getChildren())
    return
  }
  if (column.isEmpty()) column.append($createParagraphNode())
}

function $restoreRange(selection: RangeSelection) {
  if (!$isValidRange(selection)) return false
  $setSelection(selection)
  return true
}

function $isAtEdge(point: PointType, target: LexicalNode, start: boolean) {
  let node = point.getNode()
  const limit = $isElementNode(node)
    ? node.getChildrenSize()
    : node.getTextContentSize()
  if (point.offset !== (start ? 0 : limit)) return false

  while (!node.is(target)) {
    if (start ? node.getPreviousSibling() : node.getNextSibling()) return false
    const parent = node.getParent()
    if (!parent) return false
    node = parent
  }
  return true
}

function $getSelectionContainer(point: PointType) {
  const node = point.getNode()
  return $isRootOrShadowRoot(node) ? node : $getNearestRootOrShadowRoot(node)
}

function $getEdgeBlock(
  point: PointType,
  container: ElementNode,
  start: boolean,
) {
  let block = point.getNode()
  if (block.is(container)) {
    return container.getChildAtIndex(start ? point.offset : point.offset - 1)
  }
  let parent = block.getParentOrThrow()
  while (!parent.is(container)) {
    block = parent
    parent = block.getParentOrThrow()
  }
  // A selection endpoint on a block boundary does not select the adjacent block.
  if (!$isAtEdge(point, block, !start)) return block
  return start ? block.getNextSibling() : block.getPreviousSibling()
}

function $getSelectedBlocks(selection: RangeSelection, container: ElementNode) {
  const { anchor, focus } = selection
  const backward = selection.isBackward()
  const first = $getEdgeBlock(backward ? focus : anchor, container, true)
  const last = $getEdgeBlock(backward ? anchor : focus, container, false)
  return first && last
    ? container
        .getChildren()
        .slice(first.getIndexWithinParent(), last.getIndexWithinParent() + 1)
    : []
}

function $ensureFollowingBlock(layout: ColumnLayoutNode) {
  if (!layout.getNextSibling()) layout.insertAfter($createParagraphNode())
}

function $createLayout(blocks: LexicalNode[], count: 2 | 3) {
  const layout = $createColumnLayoutNode()
  const columns = Array.from({ length: count }, $createColumnNode)
  layout.append(...columns)
  if (!blocks.length) $insertNodeToNearestRoot(layout)
  else {
    blocks[0].insertBefore(layout)
    let offset = 0
    columns.forEach((column, index) => {
      const size = Math.ceil((blocks.length - offset) / (count - index))
      if (!size) return
      column.splice(0, 1, blocks.slice(offset, offset + size))
      offset += size
    })
  }
  $ensureFollowingBlock(layout)
  columns[0].selectStart()
}

function $resizeLayout(
  layout: ColumnLayoutNode,
  count: ColumnCount,
  selection: RangeSelection,
) {
  const columns = layout.getChildren().filter($isColumnNode)
  if (columns.length === count) return

  const bookmark = selection.clone()
  if (count === 1) {
    const firstBlock = $unwrapLayout(layout)
    if (!$restoreRange(bookmark)) firstBlock?.selectStart()
    return
  }

  if (count < columns.length) {
    const target = columns[count - 1]
    $mergeColumns(target, columns.slice(count))
    if (!$restoreRange(bookmark)) target.selectEnd()
  } else {
    for (let index = columns.length; index < count; index++) {
      layout.append($createColumnNode())
    }
  }
}

function $setColumnLayout(count: ColumnCount, selection: RangeSelection) {
  const anchorLayout = $findMatchingParent(
    selection.anchor.getNode(),
    $isColumnLayoutNode,
  )
  const focusLayout = $findMatchingParent(
    selection.focus.getNode(),
    $isColumnLayoutNode,
  )
  if (anchorLayout && anchorLayout.is(focusLayout)) {
    $resizeLayout(anchorLayout, count, selection)
    return
  }
  const container = $getSelectionContainer(selection.anchor)
  if (
    anchorLayout ||
    focusLayout ||
    !$isDocumentContainer(container) ||
    !container.is($getSelectionContainer(selection.focus))
  ) {
    toast.error('Choose text within one page or column section.')
    return
  }
  if (count === 1) return

  const blocks = selection.isCollapsed()
    ? []
    : $getSelectedBlocks(selection, container)
  if (
    blocks.some(
      (block) => $isPageBreakNode(block) || $isColumnLayoutNode(block),
    )
  ) {
    toast.error('Choose text within one page or column section.')
    return
  }
  $createLayout(blocks, count)
}

function $getColumnCaret() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const column = $getSelectionContainer(selection.anchor)
  return $isColumnNode(column) ? { column, point: selection.anchor } : null
}

function $selectAdjacentColumn(column: ColumnNode, backward: boolean) {
  const layout = column.getParentOrThrow()
  const adjacentColumn = backward
    ? column.getPreviousSibling()
    : column.getNextSibling()
  if (adjacentColumn) {
    if (backward) adjacentColumn.selectEnd()
    else adjacentColumn.selectStart()
    return
  }

  const adjacentBlock = backward
    ? layout.getPreviousSibling()
    : layout.getNextSibling()
  if ($isElementNode(adjacentBlock)) {
    if (backward) adjacentBlock.selectEnd()
    else adjacentBlock.selectStart()
    return
  }
  const paragraph = $createParagraphNode()
  if (backward) layout.insertBefore(paragraph)
  else layout.insertAfter(paragraph)
  paragraph.selectStart()
}

export const ColumnLayoutExtension = defineExtension({
  name: '@concept/column-layout',
  nodes: [ColumnLayoutNode, ColumnNode],
  register(editor) {
    let savedSelection: RangeSelection | null = null

    return mergeRegister(
      editor.registerNodeTransform(ColumnLayoutNode, $normalizeLayout),
      editor.registerNodeTransform(ColumnNode, $normalizeColumn),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) savedSelection = selection.clone()
          else if (selection) savedSelection = null
        })
      }),
      editor.registerCommand(
        SET_COLUMN_LAYOUT_COMMAND,
        (count) => {
          if (!editor.isEditable()) return false
          updateDocumentEdit(editor, () => {
            const current = $getSelection()
            const selection = current ?? savedSelection?.clone()
            if (!$isRangeSelection(selection) || !$restoreRange(selection)) {
              toast.error('Choose a text position for the columns.')
              return
            }
            $setColumnLayout(count, selection)
          })
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (
            !editor.isEditable() ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return false
          const caret = $getColumnCaret()
          if (!caret) return false
          const node = caret.point.getNode()
          if (
            $findMatchingParent(node, $isCodeNode) ||
            $findMatchingParent(node, $isListNode)
          )
            return false
          event.preventDefault()
          $selectAdjacentColumn(caret.column, event.shiftKey)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (backward) => {
          if (!editor.isEditable()) return false
          const caret = $getColumnCaret()
          if (!caret || !$isAtEdge(caret.point, caret.column, backward))
            return false
          $selectAdjacentColumn(caret.column, backward)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    )
  },
})
