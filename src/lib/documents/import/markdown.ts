import { $convertFromMarkdownString } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'
import {
  markdownWarnings,
  supportedTransformers,
} from '../markdown-transformers'
import { $applyLinkPolicy } from '../link-policy'

export function convertMarkdown(content: string, editor: LexicalEditor) {
  const transformers = supportedTransformers(editor)
  const warnings = markdownWarnings(content, transformers)
  $convertFromMarkdownString(content, transformers)
  $applyLinkPolicy()
  return warnings
}
