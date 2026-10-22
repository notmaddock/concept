import { encodeStateAsUpdate } from 'yjs'
import type { Doc } from 'yjs'

export function serializeConcept(name: string, doc: Doc): string {
  const update = encodeStateAsUpdate(doc)
  const chunks: string[] = []
  for (let offset = 0; offset < update.length; offset += 8192)
    chunks.push(String.fromCharCode(...update.subarray(offset, offset + 8192)))
  return JSON.stringify({
    format: 'concept',
    version: 1,
    name,
    origin: 'Concept',
    update: btoa(chunks.join('')),
  })
}
