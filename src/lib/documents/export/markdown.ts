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

const horizontalRule: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parent) => {
    parent.replace($createHorizontalRuleNode())
  },
  type: 'element',
}

export function exportMarkdown() {
  return $convertToMarkdownString([horizontalRule, CHECK_LIST, ...TRANSFORMERS])
}
