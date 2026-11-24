import { $isHeadingNode } from '@lexical/rich-text'
import {
  $getRoot,
  $getSelection,
  $getState,
  $isElementNode,
  $isRangeSelection,
  $setState,
  createState,
} from 'lexical'
import type { HeadingNode } from '@lexical/rich-text'
import type { LexicalNode, NodeKey } from 'lexical'
import { $getPageSetup } from '#/lib/documents/page-setup'

export const contentsTitle = 'Table of contents'
export const contentsEmpty = 'Add headings to build the table of contents.'
export const contentsAttribute = 'data-concept-table-of-contents'

const headingId = createState('headingId', {
  parse: (value) =>
    typeof value === 'string' && /^concept-heading-[a-z0-9-]+$/.test(value)
      ? value
      : '',
  resetOnCopyNode: true,
})

export interface OutlineHeading {
  key: NodeKey
  text: string
  level: number
  id: string
  page: number | null
}

export interface OutlineItem extends OutlineHeading {
  index: number
  children: OutlineItem[]
}

function headingBase(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  }
  return `concept-heading-${(hash >>> 0).toString(36)}`
}

function $collectHeadings() {
  const headings: Array<{
    node: HeadingNode
    text: string
    page: number | null
  }> = []
  const paged = $getPageSetup().mode === 'paper'
  let pageNumber = 0
  const visit = (node: LexicalNode, page: number | null) => {
    if ($isHeadingNode(node)) {
      const text = node.getTextContent().replace(/\s+/g, ' ').trim()
      headings.push({ node, text, page })
    } else if ($isElementNode(node)) {
      const currentPage =
        paged && node.getType() === 'page' ? ++pageNumber : page
      for (const child of node.getChildren()) visit(child, currentPage)
    }
  }
  visit($getRoot(), null)
  const reserved = new Set(
    headings.map(({ node }) => $getState(node, headingId)),
  )
  const used = new Set<string>()
  // Older documents need the same links in edit and read-only sessions before IDs are saved.
  const nextIndex = new Map<string, number>()
  return headings.map(({ node, text, page }) => {
    let id = $getState(node, headingId)
    if (!id || used.has(id)) {
      if (!text) return { node, id: '', text, page }
      const base = headingBase(text)
      let index = nextIndex.get(base) ?? 1
      do id = `${base}-${index++}`
      while (reserved.has(id) || used.has(id))
      nextIndex.set(base, index)
    }
    used.add(id)
    return { node, id, text, page }
  })
}

export function $persistHeadingIds() {
  for (const { node, id } of $collectHeadings()) {
    if ($getState(node, headingId) !== id) $setState(node, headingId, id)
  }
}

export function $readOutline(): OutlineHeading[] {
  return $collectHeadings()
    .filter(({ text }) => text)
    .map(({ node, id, text, page }) => ({
      key: node.getKey(),
      id,
      text,
      page,
      level: Number(node.getTag().slice(1)),
    }))
}

export function $currentHeading(): NodeKey | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  const { anchor } = selection
  let node: LexicalNode | null = anchor.getNode()
  if (
    $isElementNode(node) &&
    anchor.type === 'element' &&
    anchor.offset > 0 &&
    !$isHeadingNode(node)
  ) {
    const previous = node.getChildAtIndex(anchor.offset - 1)
    node = $isElementNode(previous)
      ? (previous.getLastDescendant() ?? previous)
      : (previous ?? node)
  }
  while (node) {
    if ($isHeadingNode(node) && node.getTextContent().trim())
      return node.getKey()
    const previous = node.getPreviousSibling()
    node = previous
      ? $isElementNode(previous)
        ? (previous.getLastDescendant() ?? previous)
        : previous
      : node.getParent()
  }
  return null
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
