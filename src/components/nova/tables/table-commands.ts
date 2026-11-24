import { $createTableNodeWithDimensions, $findTableNode } from '@lexical/table'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $addUpdateTag,
  $getNodeByKey,
  $getPreviousSelection,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  HISTORY_PUSH_TAG,
} from 'lexical'

export const maxTableRows = 30
export const maxTableColumns = 12

export function $captureTableInsertion() {
  const selection = $getSelection() ?? $getPreviousSelection()
  if (!$isRangeSelection(selection)) {
    throw new Error('Choose a text position for the table.')
  }
  const nodes = [selection.anchor.getNode(), selection.focus.getNode()]
  if (nodes.some((node) => $findTableNode(node))) {
    throw new Error('Choose a position outside the existing table.')
  }
  return {
    selection: selection.clone(),
    points: nodes.map((node) => ({
      key: node.getKey(),
      text: node.getTextContent(),
      children: $isElementNode(node) ? node.getChildrenSize() : null,
    })),
  }
}

export type TableInsertion = ReturnType<typeof $captureTableInsertion>

export function $insertTable(
  target: TableInsertion,
  rows: number,
  columns: number,
  header: boolean,
) {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    rows > maxTableRows ||
    columns < 1 ||
    columns > maxTableColumns
  ) {
    throw new Error(
      `Choose 1–${maxTableRows} rows and 1–${maxTableColumns} columns.`,
    )
  }
  for (const point of target.points) {
    const node = $getNodeByKey(point.key)
    if (
      !node?.isAttached() ||
      $findTableNode(node) ||
      node.getTextContent() !== point.text ||
      ($isElementNode(node) ? node.getChildrenSize() : null) !== point.children
    ) {
      throw new Error('The insertion target changed. Choose a position again.')
    }
  }

  $addUpdateTag(HISTORY_PUSH_TAG)
  $setSelection(target.selection.clone())
  const table = $insertNodeToNearestRoot(
    $createTableNodeWithDimensions(rows, columns, {
      rows: header,
      columns: false,
    }),
  )
  table.getFirstDescendant()?.selectStart()
  return table
}
