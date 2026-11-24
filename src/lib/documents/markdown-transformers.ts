import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/extension'
import {
  $convertToMarkdownString,
  CHECK_LIST,
  TRANSFORMERS,
} from '@lexical/markdown'
import type { ElementTransformer, Transformer } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'
import { marked } from 'marked'
import { ImageNode, $isImageNode } from '#/components/nova/nodes/ImageNode'
import { createTableMarkdown } from './table-markdown'
import { tableOfContentsMarkdown } from '#/components/nova/outline/outline-markdown'
import { createColumnLayoutMarkdown } from '#/components/nova/columns/column-exports'
import { $isPageNode, PageNode } from '#/components/nova/pages/PageNode'

export const horizontalRule: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parent) => {
    parent.replace($createHorizontalRuleNode())
  },
  type: 'element',
}

const imageFallback: ElementTransformer = {
  dependencies: [ImageNode],
  export: (node) => ($isImageNode(node) ? node.getTextContent() : null),
  regExp: /$^/,
  replace: () => {},
  type: 'element',
}

const pageContent: ElementTransformer = {
  dependencies: [PageNode],
  export: (node) =>
    $isPageNode(node)
      ? $convertToMarkdownString(markdownTransformers, node.getContentNode())
      : null,
  regExp: /$^/,
  replace: () => {},
  type: 'element',
}

export const markdownTransformers: Transformer[] = [
  createTableMarkdown(() => markdownTransformers),
  tableOfContentsMarkdown,
  createColumnLayoutMarkdown(() => markdownTransformers),
  pageContent,
  imageFallback,
  horizontalRule,
  CHECK_LIST,
  ...TRANSFORMERS,
]

export function supportedTransformers(editor: LexicalEditor): Transformer[] {
  return markdownTransformers.filter(
    (transformer) =>
      !('dependencies' in transformer) ||
      editor.hasNodes(transformer.dependencies),
  )
}

export type MarkdownWarning = {
  construct: 'code' | 'link' | 'table' | 'image'
  label: string
  message: string
}

function hasTransformerFor(
  transformers: readonly Transformer[],
  type: string,
): boolean {
  return transformers.some(
    (transformer) =>
      'dependencies' in transformer &&
      transformer.dependencies.some(
        (dependency) => dependency.getType() === type,
      ),
  )
}

function hasImportTransformerFor(
  transformers: readonly Transformer[],
  type: string,
): boolean {
  return transformers.some(
    (transformer) =>
      transformer.type === 'element' &&
      'dependencies' in transformer &&
      transformer.dependencies.some(
        (dependency) => dependency.getType() === type,
      ) &&
      transformer.regExp.source !== '$^',
  )
}

const constructs: Array<{
  construct: MarkdownWarning['construct']
  label: string
  matches: (content: string) => boolean
  supported: (transformers: readonly Transformer[]) => boolean
  message: string
}> = [
  {
    construct: 'code',
    label: 'code blocks',
    matches: (content) => /^[ \t]*```/m.test(content),
    supported: (transformers) => hasTransformerFor(transformers, 'code'),
    message: 'Fenced code blocks are not supported by this import.',
  },
  {
    construct: 'link',
    label: 'links',
    matches: (content) => /\[[^\]]*\]\([^)]*\)/.test(content),
    supported: (transformers) => hasTransformerFor(transformers, 'link'),
    message: 'Links are not supported by this import.',
  },
  {
    construct: 'table',
    label: 'tables',
    matches: (content) =>
      marked.lexer(content, { gfm: true }).some(({ type }) => type === 'table'),
    supported: (transformers) => hasTransformerFor(transformers, 'table'),
    message: 'Markdown tables are not supported by this import.',
  },
  {
    construct: 'image',
    label: 'images',
    matches: (content) => /!\[[^\]]*\]\([^)]*\)/.test(content),
    supported: (transformers) => hasImportTransformerFor(transformers, 'image'),
    message: 'Markdown images are not supported by this import.',
  },
]

export function markdownWarnings(
  content: string,
  transformers: readonly Transformer[],
): MarkdownWarning[] {
  return constructs
    .filter(
      ({ matches, supported }) => !supported(transformers) && matches(content),
    )
    .map(({ construct, label, message }) => ({ construct, label, message }))
}
