import { $convertToMarkdownString } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'
import { supportedTransformers } from '../markdown-transformers'

export function exportMarkdown(editor: LexicalEditor) {
  return $convertToMarkdownString(supportedTransformers(editor))
}
