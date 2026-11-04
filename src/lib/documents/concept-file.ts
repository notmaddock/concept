import { applyUpdate, Doc } from 'yjs'
import { downloadExport } from './export'
import { localDocumentStorage } from './storage'
import { serializeConcept } from './serialization'

export { serializeConcept } from './serialization'

export interface ConceptFile {
  format: 'concept'
  version: 1
  name: string
  origin: 'Concept'
  update: string
}

function parseFile(value: unknown): ConceptFile {
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'concept' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('origin' in value) ||
    value.origin !== 'Concept' ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !('update' in value) ||
    typeof value.update !== 'string' ||
    !value.update
  )
    throw new Error('Invalid Concept file')
  return {
    format: 'concept',
    version: 1,
    name: value.name.trim(),
    origin: 'Concept',
    update: value.update,
  }
}

export function parseConcept(text: string): ConceptFile {
  try {
    const file = parseFile(JSON.parse(text))
    const doc = new Doc()
    try {
      applyUpdate(doc, decodeUpdate(file))
      if (!doc.share.has('root')) throw new Error('Missing document content')
    } finally {
      doc.destroy()
    }
    return file
  } catch {
    throw new Error(
      'This is not a supported .concept document. Choose a valid Concept file (version 1).',
    )
  }
}

export function decodeUpdate(file: ConceptFile) {
  return Uint8Array.from(atob(file.update), (character) =>
    character.charCodeAt(0),
  )
}

export async function importConcept(file: ConceptFile, name = file.name) {
  const created = await localDocumentStorage.create()
  const doc = new Doc()
  const session = localDocumentStorage.open(created.id, doc)
  try {
    await session.whenSynced
    applyUpdate(doc, decodeUpdate(file))
    doc
      .getMap<string>('metadata')
      .set('name', name.trim() || 'Untitled document')
    await session.flush?.()
    return await localDocumentStorage.rename(created.id, name)
  } catch (error) {
    await session.destroy()
    await localDocumentStorage.delete(created.id)
    throw error
  } finally {
    await session.destroy()
    doc.destroy()
  }
}

export function downloadConcept(name: string, doc: Doc) {
  downloadExport(name, {
    content: serializeConcept(name, doc),
    extension: 'concept',
    mime: 'application/vnd.concept+json',
  })
}
