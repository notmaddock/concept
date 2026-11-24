import { buildEditorFromExtensions } from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import {
  $createTableSelectionFrom,
  $isTableCellNode,
  $isTableNode,
  TableCellHeaderStates,
  TableExtension,
} from '@lexical/table'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  defineExtension,
} from 'lexical'
import type { LexicalEditorWithDispose } from 'lexical'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { $applyTableAction, $getTableActionTarget } from './table-actions'
import type { TableAction } from './table-actions'
import { $captureTableInsertion, $insertTable } from './table-commands'
import { tableTheme } from './table-theme'

const extension = defineExtension({
  name: 'test-tables',
  dependencies: [RichTextExtension, TableExtension],
  theme: tableTheme,
})

let editor: LexicalEditorWithDispose

beforeEach(() => {
  editor = buildEditorFromExtensions(extension)
  editor.update(
    () => {
      $getRoot().clear().append($createParagraphNode())
      $getRoot().selectStart()
    },
    { discrete: true },
  )
})

afterEach(() => editor.dispose())

function update(action: () => void) {
  editor.update(action, { discrete: true })
}

function $table() {
  const table = $getRoot().getChildren().find($isTableNode)
  if (!table) throw new Error('Expected a table.')
  return table
}

function $cell(row: number, column: number) {
  const cell = $table().getChildAtIndex(row)?.getChildAtIndex(column)
  if (!$isTableCellNode(cell)) throw new Error('Expected a cell.')
  return cell
}

function run(action: TableAction) {
  update(() => {
    const target = $getTableActionTarget()
    if (!target) throw new Error('Expected a table selection.')
    $applyTableAction(action, target)
  })
}

describe('table editing', () => {
  it('inserts a header row and places the caret in the table', () => {
    update(() => $insertTable($captureTableInsertion(), 2, 3, true))

    editor.read(() => {
      expect($table().getChildrenSize()).toBe(2)
      expect($table().getColumnCount()).toBe(3)
      expect($cell(0, 2).hasHeaderState(TableCellHeaderStates.ROW)).toBe(true)
      expect($cell(1, 0).hasHeader()).toBe(false)
      expect($getTableActionTarget()?.cellKey).toBe($cell(0, 0).getKey())
      expect(() => $captureTableInsertion()).toThrow(
        'Choose a position outside the existing table.',
      )
    })
  })

  it('preserves content surrounding an insertion and rejects a changed target', () => {
    update(() => {
      const text = $createTextNode('beforeafter')
      $getRoot().clear().append($createParagraphNode().append(text))
      text.select(6, 6)
      $insertTable($captureTableInsertion(), 2, 2, false)
    })
    editor.read(() => {
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ).toEqual(['paragraph', 'table', 'paragraph'])
      expect($getRoot().getFirstChild()?.getTextContent()).toBe('before')
      expect($getRoot().getLastChild()?.getTextContent()).toBe('after')
    })

    update(() => {
      const paragraph = $getRoot().getLastChildOrThrow()
      paragraph.selectEnd()
      const target = $captureTableInsertion()
      paragraph.remove()
      expect(() => $insertTable(target, 2, 2, false)).toThrow(
        'The insertion target changed.',
      )
    })
  })

  it('adds and deletes rows and columns and sets both kinds of header', () => {
    update(() => $insertTable($captureTableInsertion(), 2, 2, false))
    run('header-row')
    run('header-column')

    editor.read(() => {
      expect($cell(0, 0).getHeaderStyles()).toBe(TableCellHeaderStates.BOTH)
      expect($cell(0, 1).getHeaderStyles()).toBe(TableCellHeaderStates.ROW)
      expect($cell(1, 0).getHeaderStyles()).toBe(TableCellHeaderStates.COLUMN)
    })

    run('row-after')
    run('column-after')
    editor.read(() => {
      expect($table().getChildrenSize()).toBe(3)
      expect($table().getColumnCount()).toBe(3)
    })
    run('delete-column')
    run('delete-row')
    editor.read(() => {
      expect($table().getChildrenSize()).toBe(2)
      expect($table().getColumnCount()).toBe(2)
    })
  })

  it('preserves text when merging cells and restores the grid when splitting', () => {
    update(() => $insertTable($captureTableInsertion(), 2, 2, false))
    update(() => {
      const first = $cell(0, 0)
      const second = $cell(0, 1)
      first
        .clear()
        .append($createParagraphNode().append($createTextNode('first')))
      second
        .clear()
        .append($createParagraphNode().append($createTextNode('second')))
      $setSelection($createTableSelectionFrom($table(), first, second))
    })
    run('merge')
    editor.read(() => {
      expect($cell(0, 0).getColSpan()).toBe(2)
      expect($cell(0, 0).getTextContent()).toContain('first')
      expect($cell(0, 0).getTextContent()).toContain('second')
    })
    run('split')
    editor.read(() => {
      expect($cell(0, 0).getColSpan()).toBe(1)
      expect($cell(0, 1).getTextContent()).toBe('')
    })
  })

  it('keeps an editable paragraph after deleting the table', () => {
    update(() => {
      $insertTable($captureTableInsertion(), 2, 2, false)
      const table = $table()
      $getRoot()
        .getChildren()
        .forEach((node) => {
          if (!node.is(table)) node.remove()
        })
      $cell(0, 0).selectStart()
    })
    run('delete-table')
    editor.read(() =>
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ).toEqual(['paragraph']),
    )
  })
})
