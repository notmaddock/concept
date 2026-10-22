import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { z } from 'zod'
import { localDocumentStorage } from './storage'

const conceptFile = z.object({
  format: z.literal('concept'),
  version: z.literal(1),
  name: z.string().trim().min(1),
  origin: z.literal('Concept'),
  update: z.string().min(1),
})

export type ConceptFile = z.infer<typeof conceptFile>

export function serializeConcept(name: string, doc: Doc): string {
  const update = encodeStateAsUpdate(doc)
  let binary = ''
  for (const byte of update) binary += String.fromCharCode(byte)
  return JSON.stringify({
    format: 'concept',
    version: 1,
    name,
    origin: 'Concept',
    update: btoa(binary),
  })
}

export function parseConcept(text: string): ConceptFile {
  try {
    const file = conceptFile.parse(JSON.parse(text))
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

function decodeUpdate(file: ConceptFile) {
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
