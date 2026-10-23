import type { Doc } from 'yjs'
import { localDocumentStorage } from './storage'
import type { DocumentInfo } from './storage'
import { persistDocumentUpdate, updateDocumentInfo } from './storages/local'
import { serializeConcept } from './serialization'
import { validateDocumentContent } from './validate-content'

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
    validateDocumentContent(decodeUpdate(file))
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

export async function importConcept(
  file: ConceptFile,
  name = file.name,
  target?: DocumentInfo,
) {
  validateDocumentContent(decodeUpdate(file))
  const initial = { existed: false, pendingRename: false }
  const created = target
    ? await updateDocumentInfo(target.id, (current) => {
        initial.existed = !!current
        initial.pendingRename =
          !!current?.backing && current.name !== current.backing.syncedName
        if (
          current &&
          (current.backing?.provider !== target.backing?.provider ||
            current.backing?.fileId !== target.backing?.fileId ||
            current.backing?.accountId !== target.backing?.accountId)
        )
          throw new Error(
            'A different document already uses this Concept ID in this browser.',
          )
        return current ?? target
      })
    : await localDocumentStorage.create()
  if (!created) throw new Error('Document not found')
  try {
    await persistDocumentUpdate(created.id, decodeUpdate(file))
    const result = target
      ? await updateDocumentInfo(target.id, (current) =>
          current
            ? {
                ...target,
                name:
                  initial.pendingRename ||
                  current.name !== created.name ||
                  (current.backing &&
                    current.name !== current.backing.syncedName)
                    ? current.name
                    : name,
              }
            : undefined,
        )
      : await localDocumentStorage.rename(created.id, name)
    if (!result) throw new Error('Document not found')
    return result
  } catch (error) {
    if (!initial.existed) await localDocumentStorage.delete(created.id)
    throw error
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
