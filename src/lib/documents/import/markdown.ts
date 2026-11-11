import { $convertFromMarkdownString } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'
import {
  supportedTransformers,
  warnUnsupportedMarkdown,
} from '../markdown-transformers'
import { $applyLinkPolicy } from '../link-policy'

export function convertMarkdown(content: string, editor: LexicalEditor) {
  const transformers = supportedTransformers(editor)
  warnUnsupportedMarkdown(content, transformers)
  $convertFromMarkdownString(content, transformers)
  $applyLinkPolicy()
}
