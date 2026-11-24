import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  defineExtension,
} from 'lexical'
import { $createTableOfContentsNode } from './TableOfContentsNode'
import { updateDocumentEdit } from '../document-edit'

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
        updateDocumentEdit(editor, () => {
          $insertNodeToNearestRoot($createTableOfContentsNode())
        })
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
})
