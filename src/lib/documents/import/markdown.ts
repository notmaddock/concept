import {
  $convertFromMarkdownString,
  CHECK_LIST,
  TRANSFORMERS,
} from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'
import { horizontalRule } from '../export/markdown'
import { $applyLinkPolicy } from '../link-policy'

export function convertMarkdown(content: string, editor: LexicalEditor) {
  const transformers = [horizontalRule, CHECK_LIST, ...TRANSFORMERS].filter(
    (transformer) =>
      !('dependencies' in transformer) ||
      editor.hasNodes(transformer.dependencies),
  )
  $convertFromMarkdownString(content, transformers)
  $applyLinkPolicy()
}
