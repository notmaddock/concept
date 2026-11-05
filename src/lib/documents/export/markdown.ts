import { ImageNode, $isImageNode } from '#/components/nova/nodes/ImageNode'
import {
  $convertToMarkdownString,
  CHECK_LIST,
  TRANSFORMERS,
} from '@lexical/markdown'
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/extension'
import type { ElementTransformer } from '@lexical/markdown'

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

export function exportMarkdown() {
  return $convertToMarkdownString([
    imageFallback,
    horizontalRule,
    CHECK_LIST,
    ...TRANSFORMERS,
  ])
}
