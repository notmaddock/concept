import type { BaseSerializedNode } from '@lexical/clipboard'
import type { AssetId } from '#/lib/documents/assets'
import { isAssetId } from '#/lib/documents/assets'
import { imageTransferLimits } from '#/lib/documents/image-transfer'
import {
  validateImageSource,
  validateImageDisplayWidth,
} from '#/lib/documents/image-schema'

export interface ImageFragment {
  version: 1
  nodes: BaseSerializedNode[]
  assets: Record<string, string | null>
}

export function fragmentReferences(nodes: BaseSerializedNode[]) {
  const ids = new Set<AssetId>()
  let count = 0
  const visit = (input: unknown, depth: number) => {
    if (!input || typeof input !== 'object')
      throw new Error('Invalid clipboard content.')
    const node = input as BaseSerializedNode
    if (
      ++count > imageTransferLimits.nodes ||
      depth > imageTransferLimits.depth
    )
      throw new Error('Clipboard content is too complex.')
    if (typeof node.type !== 'string' || node.$slots)
      throw new Error('Invalid clipboard content.')
    if (node.type === 'image') {
      const image = node as BaseSerializedNode & {
        source?: unknown
        altText?: unknown
        displayWidth?: unknown
      }
      if (
        node.version !== 1 ||
        typeof image.altText !== 'string' ||
        image.altText.length > 10000
      )
        throw new Error('Unsupported clipboard image.')
      ids.add(validateImageSource(image.source).assetId)
      validateImageDisplayWidth(image.displayWidth)
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children))
        throw new Error('Invalid clipboard content.')
      node.children.forEach((child) => visit(child, depth + 1))
    }
  }
  nodes.forEach((node) => visit(node, 0))
  if (ids.size > imageTransferLimits.assets)
    throw new Error('Too many clipboard images.')
  return ids
}

export function parseImageFragment(value: string): ImageFragment {
  if (value.length > imageTransferLimits.bytes * 1.5)
    throw new Error('Clipboard content is too large.')
  const fragment = JSON.parse(value) as Partial<ImageFragment>
  if (
    fragment.version !== 1 ||
    !Array.isArray(fragment.nodes) ||
    !fragment.assets ||
    typeof fragment.assets !== 'object'
  )
    throw new Error('Unsupported Concept clipboard format.')
  const ids = fragmentReferences(fragment.nodes)
  const keys = Object.keys(fragment.assets)
  if (
    keys.length !== ids.size ||
    keys.some((id) => !isAssetId(id) || !ids.has(id))
  )
    throw new Error('Clipboard image records do not match their references.')
  for (const id of ids) {
    if (
      !(id in fragment.assets) ||
      (fragment.assets[id] !== null && typeof fragment.assets[id] !== 'string')
    )
      throw new Error('Clipboard image bytes are missing.')
  }
  return fragment as ImageFragment
}

export function fragmentHtml(html: string, fragment: ImageFragment) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-concept-fragment', JSON.stringify(fragment))
  wrapper.append(...document.body.childNodes)
  return wrapper.outerHTML
}
