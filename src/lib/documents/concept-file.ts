import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
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
  let persistence: IndexeddbPersistence | undefined
  try {
    applyUpdate(doc, decodeUpdate(file))
    persistence = new IndexeddbPersistence(
      `concept-document:${created.id}`,
      doc,
    )
    await persistence.whenSynced
    const db = persistence.db
    if (!db) throw new Error('Local storage is unavailable.')
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('updates', 'readwrite')
      transaction.objectStore('updates').add(encodeStateAsUpdate(doc))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error('Could not save document content.'),
        )
      transaction.onerror = () => reject(transaction.error)
    })
    return await localDocumentStorage.rename(created.id, name)
  } catch (error) {
    await persistence?.destroy()
    persistence = undefined
    await localDocumentStorage.delete(created.id)
    throw error
  } finally {
    await persistence?.destroy()
    doc.destroy()
  }
}

export function downloadConcept(name: string, doc: Doc) {
  const blob = new Blob([serializeConcept(name, doc)], {
    type: 'application/vnd.concept+json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${Array.from(name, (character) => (character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character)).join('') || 'Untitled document'}.concept`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
