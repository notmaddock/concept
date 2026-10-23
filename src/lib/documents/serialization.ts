import { encodeStateAsUpdate } from 'yjs'
import type { Doc } from 'yjs'

export function serializeConcept(name: string, doc: Doc): string {
  const update = encodeStateAsUpdate(doc)
  const chunks: string[] = []
  for (let offset = 0; offset < update.length; offset += 8192)
    chunks.push(String.fromCharCode(...update.subarray(offset, offset + 8192)))
  return JSON.stringify(conceptFile(name, btoa(chunks.join(''))))
}

function conceptFile(name: string, update: string) {
  return { format: 'concept', version: 1, name, origin: 'Concept', update }
}

// Match the exported file's UTF-8 size without allocating its Base64 string.
export function conceptFileSize(name: string, doc: Doc): number {
  const updateBytes = encodeStateAsUpdate(doc).byteLength
  const metadataBytes = new TextEncoder().encode(
    JSON.stringify(conceptFile(name, '')),
  ).byteLength
  return metadataBytes + 4 * Math.ceil(updateBytes / 3)
}
