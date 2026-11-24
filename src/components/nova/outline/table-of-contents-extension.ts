import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $addUpdateTag,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  defineExtension,
  HISTORY_PUSH_TAG,
} from 'lexical'
import { $createTableOfContentsNode } from './TableOfContentsNode'

export const INSERT_TABLE_OF_CONTENTS_COMMAND = createCommand<void>(
  'INSERT_TABLE_OF_CONTENTS_COMMAND',
)

export const TableOfContentsExtension = defineExtension({
  name: '@concept/table-of-contents',
  register: (editor) =>
    editor.registerCommand(
      INSERT_TABLE_OF_CONTENTS_COMMAND,
      () => {
        if (!editor.isEditable()) return false
        $addUpdateTag(HISTORY_PUSH_TAG)
        $insertNodeToNearestRoot($createTableOfContentsNode())
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
})
