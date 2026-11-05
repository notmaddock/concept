import { applyUpdate, Doc } from 'yjs'
import { downloadExport } from './export'
import { localDocumentStorage } from './storage'
import { readPackage, writePackage } from './package'
import type { AssetId } from './assets'
import type { NormalizedSnapshot } from './package'
import { captureSnapshot, documentAssets } from './working'

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

export async function readConcept(input: Blob | Uint8Array) {
  const result = await readPackage(input)
  if (result.kind === 'unsupported')
    throw new Error(
      'This document requires a newer version of Concept. The original has not been changed.',
    )
  return result
}

export function normalizeLegacy(file: ConceptFile): NormalizedSnapshot {
  return {
    name: file.name,
    update: decodeUpdate(file),
    assets: [],
    requiredFeatures: [],
  }
}

export async function importConcept(
  file: ConceptFile | NormalizedSnapshot,
  name = file.name,
  missingAssets?: AssetId[],
) {
  const snapshot = 'version' in file ? normalizeLegacy(file) : file
  const created = await localDocumentStorage.createStaged()
  const doc = new Doc()
  const session = localDocumentStorage.open(created.id, doc)
  try {
    await session.whenSynced
    await documentAssets(doc)!.importAssets(snapshot.assets)
    applyUpdate(doc, snapshot.update)
    doc
      .getMap<string>('metadata')
      .set('name', name.trim() || 'Untitled document')
    await session.flush?.()
    return await localDocumentStorage.patch(created.id, (current) => ({
      ...current,
      name: name.trim() || 'Untitled document',
      importing: undefined,
      recoveryMissingAssets: missingAssets,
    }))
  } catch (error) {
    await session.destroy()
    await localDocumentStorage.delete(created.id)
    throw error
  } finally {
    await session.destroy()
    doc.destroy()
  }
}

export async function downloadConcept(name: string, doc: Doc) {
  const snapshot = await captureSnapshot(name, doc)
  const content = await writePackage(snapshot)
  downloadExport(name, {
    content: new Blob([content as Uint8Array<ArrayBuffer>]),
    extension: 'concept',
    mime: 'application/vnd.concept+zip',
  })
}
