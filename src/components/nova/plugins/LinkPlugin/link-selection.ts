import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import type { LinkNode } from '@lexical/link'
import { $findMatchingParent } from '@lexical/utils'
import { $isRangeSelection } from 'lexical'
import type { BaseSelection, LexicalNode } from 'lexical'
import { getSelectedNode } from '../../utils'

/*
 * Removing an autolink only marks it unlinked: the node stays in the tree as
 * plain text. It must not count as a link for editing UI, or the floating
 * editor reopens on text that no longer renders as a link.
 */
export function $isActiveLink(
  node: LexicalNode | null | undefined,
): node is LinkNode {
  return $isLinkNode(node) && !($isAutoLinkNode(node) && node.getIsUnlinked())
}

export function $findLinkNode(selection: BaseSelection | null) {
  if (!$isRangeSelection(selection)) return null
  const node = getSelectedNode(selection)
  if ($isActiveLink(node)) return node
  const parent = $findMatchingParent(node, $isActiveLink)
  return $isActiveLink(parent) ? parent : null
}
