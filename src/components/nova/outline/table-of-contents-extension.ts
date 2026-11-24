import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  COMMAND_PRIORITY_EDITOR,
  RootNode,
  defineExtension,
  mergeRegister,
} from 'lexical'
import { $createTableOfContentsNode } from './TableOfContentsNode'
import { updateDocumentEdit } from '../document-edit'
import { INSERT_TABLE_OF_CONTENTS_COMMAND } from './commands'
import { $persistHeadingIds } from './outline'

export const TableOfContentsExtension = defineExtension({
  name: '@concept/table-of-contents',
  register: (editor) =>
    mergeRegister(
      editor.registerNodeTransform(RootNode, () => {
        if (editor.isEditable()) $persistHeadingIds()
      }),
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
    ),
})
