import { $getRoot, $isElementNode } from 'lexical'
import type { LexicalNode } from 'lexical'
import { $isLinkNode } from '@lexical/link'

const allowedProtocols: Record<string, true> = {
  'http:': true,
  'https:': true,
  'mailto:': true,
  'tel:': true,
}
const schemePattern = /^[a-z][a-z0-9+.-]*:/i
const externalRel = ['noopener', 'noreferrer', 'nofollow']

export function normalizeLinkUrl(input: string): string | null {
  const value = input.trim()
  if (!value || /\s/.test(value)) return null
  const candidate = schemePattern.test(value) ? value : `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  return Object.hasOwn(allowedProtocols, parsed.protocol) ? candidate : null
}

export function isExternalLink(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function linkAttributes(url: string): { target?: string; rel?: string } {
  return isExternalLink(url)
    ? { target: '_blank', rel: 'noopener noreferrer nofollow' }
    : {}
}

export function $applyLinkPolicyToNode(node: LexicalNode) {
  if (!$isLinkNode(node) || !isExternalLink(node.getURL())) return
  if (node.getTarget() !== '_blank') node.setTarget('_blank')
  const tokens = (node.getRel() ?? '').split(/\s+/).filter(Boolean)
  if (externalRel.every((token) => tokens.includes(token))) return
  node.setRel([...new Set([...tokens, ...externalRel])].join(' '))
}

export function $applyLinkPolicy() {
  const visit = (node: LexicalNode) => {
    if ($isLinkNode(node)) {
      if (!normalizeLinkUrl(node.getURL())) {
        const children = node.getChildren()
        for (const child of children) node.insertBefore(child)
        node.remove()
        return
      }
      $applyLinkPolicyToNode(node)
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  visit($getRoot())
}
