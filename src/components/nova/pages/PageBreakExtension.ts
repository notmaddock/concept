import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $findMatchingParent,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  defineExtension,
} from 'lexical'
import type { LexicalCommand } from 'lexical'
import { $isColumnLayoutNode } from '../columns/ColumnLayoutNode'
import { $createPageBreakNode, PageBreakNode } from './PageBreakNode'

export const INSERT_PAGE_BREAK: LexicalCommand<void> =
  createCommand('INSERT_PAGE_BREAK')

export const PageBreakExtension = defineExtension({
  name: '@concept/page-break',
  nodes: () => [PageBreakNode],
  register: (editor) =>
    editor.registerCommand(
      INSERT_PAGE_BREAK,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        const columns = $findMatchingParent(
          selection.focus.getNode(),
          $isColumnLayoutNode,
        )
        if (columns) {
          const after = columns.getIndexWithinParent() + 1
          columns.getParentOrThrow().select(after, after)
        }
        $insertNodeToNearestRoot($createPageBreakNode())
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
})
