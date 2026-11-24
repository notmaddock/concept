import type { ElementTransformer } from '@lexical/markdown'
import {
  $isTableOfContentsNode,
  TableOfContentsNode,
} from './TableOfContentsNode'
import { $readOutline, contentsTitle, nestOutline } from './outline'
import type { OutlineItem } from './outline'

function markdownEntries(items: readonly OutlineItem[], indent = ''): string[] {
  return items.flatMap((item) => [
    `${indent}- ${item.text.replace(/[&<>"'\\\x60*_{}[\]()#!|~]/g, '\\$&')}`,
    ...markdownEntries(item.children, indent + '  '),
  ])
}

export const tableOfContentsMarkdown: ElementTransformer = {
  dependencies: [TableOfContentsNode],
  export: (node) => {
    if (!$isTableOfContentsNode(node)) return null
    const entries = markdownEntries(nestOutline($readOutline()))
    return [`**${contentsTitle}**`, '', ...entries].join('\n').trimEnd()
  },
  regExp: /$^/,
  replace: () => {},
  type: 'element',
}
