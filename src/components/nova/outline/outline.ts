import { $isHeadingNode } from '@lexical/rich-text'
import { $getRoot, $isElementNode } from 'lexical'
import type { ElementNode, LexicalNode, NodeKey } from 'lexical'

export const contentsTitle = 'Table of contents'
export const contentsEmpty = 'Add headings to build the table of contents.'
export const contentsAttribute = 'data-concept-table-of-contents'

export interface OutlineHeading {
  key: NodeKey
  text: string
  level: number
}

export interface OutlineItem extends OutlineHeading {
  index: number
  children: OutlineItem[]
}

export function $readOutline(): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  const visit = (parent: ElementNode) => {
    for (const node of parent.getChildren()) {
      if ($isHeadingNode(node)) {
        const text = node.getTextContent().replace(/\s+/g, ' ').trim()
        if (text) {
          headings.push({
            key: node.getKey(),
            text,
            level: Number(node.getTag().slice(1)),
          })
        }
      } else if ($isElementNode(node)) {
        visit(node)
      }
    }
  }
  visit($getRoot())
  return headings
}

export function nestOutline(
  headings: readonly OutlineHeading[],
): OutlineItem[] {
  const outline: OutlineItem[] = []
  const ancestors: OutlineItem[] = []
  for (const [index, heading] of headings.entries()) {
    while (ancestors.length && ancestors.at(-1)!.level >= heading.level) {
      ancestors.pop()
    }
    const item: OutlineItem = { ...heading, index, children: [] }
    const siblings = ancestors.at(-1)?.children ?? outline
    siblings.push(item)
    ancestors.push(item)
  }
  return outline
}

export function headingAnchor(key: NodeKey) {
  return `concept-live-heading-${key}`
}

export function $decorateOutlineHeading(
  node: LexicalNode,
  element: HTMLElement,
) {
  if (!$isHeadingNode(node)) return
  element.id = headingAnchor(node.getKey())
  element.tabIndex = -1
}
