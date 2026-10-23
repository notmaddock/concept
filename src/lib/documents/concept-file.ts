import type { Doc } from 'yjs'
import {
  localDocumentStorage,
  persistDocumentUpdate,
  updateDocumentInfo,
} from './storages/local'
import { validateDocumentContent } from './validate-content'
import type { DocumentInfo } from './storage'
import { serializeConcept } from './serialization'

export { serializeConcept, conceptFileSize } from './serialization'

export interface ConceptFile {
  format: 'concept'
  version: 1
  name: string
  origin: string
  update: string
}

function parseFile(value: unknown): ConceptFile {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error()
  const candidate = value as Partial<ConceptFile>
  if (
    candidate.format !== 'concept' ||
    candidate.version !== 1 ||
    typeof candidate.name !== 'string' ||
    !candidate.name.trim() ||
    typeof candidate.origin !== 'string' ||
    candidate.origin !== 'Concept' ||
    typeof candidate.update !== 'string'
  )
    throw new Error()
  return {
    format: candidate.format,
    version: candidate.version,
    name: candidate.name.trim(),
    origin: candidate.origin,
    update: candidate.update,
  }
}

export function decodeUpdate(update: string | ConceptFile): Uint8Array {
  const base64 = typeof update === 'string' ? update : update.update
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
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

export async function importConcept(
  file: ConceptFile,
  name = file.name,
  target?: DocumentInfo,
) {
  const updateBytes = decodeUpdate(file)
  validateDocumentContent(updateBytes)
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
    await persistDocumentUpdate(created.id, updateBytes)
    const result = target
      ? await updateDocumentInfo(target.id, (current) =>
          current
            ? {
                ...target,
                pendingSync: current.pendingSync,
                name:
                  initial.pendingRename ||
                  current.name !== created.name ||
                  (current.backing &&
                    current.name !== current.backing.syncedName)
                    ? current.name
                    : name,
                updatedAt: Math.max(
                  current.updatedAt,
                  target.updatedAt,
                  Date.now(),
                ),
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
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
