import {
  $createTableSelectionFrom,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $findCellNode,
  $findTableNode,
  $getTableCellNodeRect,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  $mergeCells,
  $setTableColumnIsHeader,
  $setTableRowIsHeader,
  $unmergeCellNode,
  TableCellHeaderStates,
} from '@lexical/table'
import {
  $addUpdateTag,
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  HISTORY_PUSH_TAG,
} from 'lexical'
import type { NodeKey } from 'lexical'

export type TableAction =
  | 'row-before'
  | 'row-after'
  | 'column-before'
  | 'column-after'
  | 'header-row'
  | 'header-column'
  | 'merge'
  | 'split'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

export interface TableActionTarget {
  anchorKey: NodeKey
  cellKey: NodeKey
  tableKey: NodeKey
  headerRow: boolean
  headerColumn: boolean
  mergedCell: boolean
}

export function $getTableActionTarget(): TableActionTarget | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) && !$isTableSelection(selection))
    return null

  const anchor = $findCellNode(selection.anchor.getNode())
  const focus = $findCellNode(selection.focus.getNode())
  const table = focus && $findTableNode(focus)
  if (!anchor || !focus || !table || !table.is($findTableNode(anchor)))
    return null

  return {
    anchorKey: anchor.getKey(),
    cellKey: focus.getKey(),
    tableKey: table.getKey(),
    headerRow: focus.hasHeaderState(TableCellHeaderStates.ROW),
    headerColumn: focus.hasHeaderState(TableCellHeaderStates.COLUMN),
    mergedCell: focus.getColSpan() > 1 || focus.getRowSpan() > 1,
  }
}

export function $applyTableAction(
  action: TableAction,
  target: TableActionTarget,
) {
  const anchor = $getNodeByKey(target.anchorKey)
  const focus = $getNodeByKey(target.cellKey)
  const table = $isTableCellNode(focus) ? $findTableNode(focus) : null
  if (
    !$isTableCellNode(anchor) ||
    !anchor.isAttached() ||
    !$isTableCellNode(focus) ||
    !focus.isAttached() ||
    !table ||
    table.getKey() !== target.tableKey ||
    !table.is($findTableNode(anchor))
  ) {
    throw new Error('The table selection changed. Select the cells again.')
  }

  $addUpdateTag(HISTORY_PUSH_TAG)
  const live = $getTableActionTarget()
  if (anchor.is(focus)) {
    if (live?.anchorKey !== target.anchorKey || live.cellKey !== target.cellKey)
      focus.selectStart()
  } else if (
    !$isTableSelection($getSelection()) ||
    live?.anchorKey !== target.anchorKey ||
    live.cellKey !== target.cellKey
  ) {
    $setSelection($createTableSelectionFrom(table, anchor, focus))
  }
  const parent = table.getParentOrThrow()
  switch (action) {
    case 'row-before':
    case 'row-after':
      $insertTableRowAtSelection(action === 'row-after')
        ?.getFirstDescendant()
        ?.selectStart()
      break
    case 'column-before':
    case 'column-after':
      $insertTableColumnAtSelection(action === 'column-after')?.selectStart()
      break
    case 'header-row':
    case 'header-column': {
      const rect = $getTableCellNodeRect(focus)
      if (!rect) return
      if (action === 'header-row') {
        $setTableRowIsHeader(
          table,
          rect.rowIndex,
          !focus.hasHeaderState(TableCellHeaderStates.ROW),
        )
      } else {
        $setTableColumnIsHeader(
          table,
          rect.columnIndex,
          !focus.hasHeaderState(TableCellHeaderStates.COLUMN),
        )
      }
      break
    }
    case 'merge': {
      const selection = $getSelection()
      if ($isTableSelection(selection)) {
        $mergeCells(selection.getNodes().filter($isTableCellNode))?.selectEnd()
      }
      break
    }
    case 'split':
      $unmergeCellNode(focus)
      focus.selectStart()
      break
    case 'delete-row':
      $deleteTableRowAtSelection()
      break
    case 'delete-column':
      $deleteTableColumnAtSelection()
      break
    case 'delete-table':
      table.selectPrevious()
      table.remove()
      break
  }

  if (parent.isEmpty()) {
    const paragraph = $createParagraphNode()
    parent.append(paragraph)
    paragraph.selectStart()
  }
}
