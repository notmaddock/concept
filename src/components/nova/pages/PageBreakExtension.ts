import { $insertNodeToNearestRoot } from '@lexical/utils'
import { $findTableNode } from '@lexical/table'
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
        const focus = selection.focus.getNode()
        const container =
          $findMatchingParent(focus, $isColumnLayoutNode) ??
          $findTableNode(focus)
        if (container) {
          const after = container.getIndexWithinParent() + 1
          container.getParentOrThrow().select(after, after)
        }
        $insertNodeToNearestRoot($createPageBreakNode())
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
})
