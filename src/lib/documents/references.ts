import {
  applyUpdate,
  Doc,
  encodeStateAsUpdate,
  Map as YMap,
  XmlElement,
  XmlText,
} from 'yjs'
import { isAssetId } from './assets'
import type { AssetId } from './assets'

export interface PersistedNode {
  type: string
  get: (field: string) => unknown
}

export type AssetReferenceCollector = (node: PersistedNode) => Iterable<AssetId>

const collectors = new Map<string, AssetReferenceCollector>()
const referenceFreeTypes = new Set([
  'root',
  'paragraph',
  'text',
  'linebreak',
  'tab',
  'heading',
  'quote',
  'list',
  'listitem',
  'code',
  'code-highlight',
  'horizontalrule',
])

export class UnsupportedNodeError extends Error {
  readonly code = 'unsupported-node'
  constructor(readonly nodeType: string) {
    super(
      `This document requires support for the “${nodeType}” node before it can be saved.`,
    )
  }
}

export function registerAssetReferenceCollector(
  type: string,
  collector: AssetReferenceCollector,
) {
  if (collectors.has(type) || referenceFreeTypes.has(type))
    throw new Error(`A reference collector for ${type} is already registered`)
  collectors.set(type, collector)
  return () => {
    if (collectors.get(type) === collector) collectors.delete(type)
  }
}

export function assetReferenceField(
  node: PersistedNode,
  field: string,
): AssetId[] {
  const value = node.get(field)
  if (!isAssetId(value))
    throw new Error(`Invalid asset reference in ${node.type}.${field}`)
  return [value]
}

export function collectReferences(update: Uint8Array): ReadonlySet<AssetId> {
  const doc = new Doc()
  const references = new Set<AssetId>()
  try {
    applyUpdate(doc, update)
    if (!doc.share.has('root')) throw new Error('Missing document content')
    const root = doc.get('root', XmlText)
    const visited = new Set<unknown>()
    const visit = (value: unknown) => {
      if (visited.has(value)) return
      if (!(
        value instanceof XmlText ||
        value instanceof XmlElement ||
        value instanceof YMap
      ))
        return
      visited.add(value)
      const get = (field: string): unknown =>
        value instanceof YMap ? value.get(field) : value.getAttribute(field)
      const type = get('__type')
      if (typeof type === 'string') {
        const collector = collectors.get(type)
        if (collector)
          for (const id of collector({ type, get })) {
            if (!isAssetId(id))
              throw new Error('Invalid collected asset reference')
            references.add(id)
          }
        else if (!referenceFreeTypes.has(type))
          throw new UnsupportedNodeError(type)
      }
      // Lexical binding v1 stores elements as XmlText, decorators as XmlElement,
      // text properties as Y.Map, and child shared types inside XmlText deltas.
      if (value instanceof XmlText)
        for (const delta of value.toDelta()) visit(delta.insert)
      if (value instanceof XmlElement)
        for (const child of value.toArray()) visit(child)
      const slots = get('__slots')
      if (slots instanceof YMap)
        for (const child of slots.values()) visit(child)
    }
    visit(root)
    return references
  } finally {
    doc.destroy()
  }
}

export function captureDocument(doc: Doc, name: string) {
  const update = encodeStateAsUpdate(doc)
  return {
    name: name.trim() || 'Untitled document',
    update,
    requiredAssets: collectReferences(update),
  }
}
