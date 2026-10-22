import { Doc } from 'yjs'
import type { ConceptFile } from './concept-file'
import type { DocumentInfo } from './storage'
import { importConcept, parseConcept, serializeConcept } from './concept-file'
import { localDocumentStorage } from './storage'

export interface SelectedDocument {
  file: ConceptFile
  filename: string
  size: number
  origin: string
  existingId?: string
}

interface SourceInfo {
  id: string
  label: string
  description: string
}

export type DocumentSource = SourceInfo &
  (
    | { kind: 'device' }
    | {
        kind: 'library'
        list: () => Promise<Array<DocumentInfo>>
        read: (document: DocumentInfo) => Promise<SelectedDocument>
      }
  )

export interface DocumentSaveProvider extends SourceInfo {
  save: (file: ConceptFile, name: string) => Promise<DocumentInfo>
}

export const documentSources: Array<DocumentSource> = [
  {
    id: 'device',
    label: 'This device',
    description: 'Choose a .concept file',
    kind: 'device',
  },
  {
    id: 'local',
    label: 'Local library',
    description: 'Documents saved in this browser',
    kind: 'library',
    list: () => localDocumentStorage.list(),
    async read(document) {
      const doc = new Doc()
      const session = localDocumentStorage.open(document.id, doc)
      try {
        await session.whenSynced
        const text = serializeConcept(document.name, doc)
        return {
          file: parseConcept(text),
          filename: document.name,
          size: new Blob([text]).size,
          origin: 'Local library · This browser',
          existingId: document.id,
        }
      } finally {
        await session.destroy()
        doc.destroy()
      }
    },
  },
]

export const documentSaveProviders: Array<DocumentSaveProvider> = [
  {
    id: 'local',
    label: 'Local library',
    description: 'Saved in this browser’s library',
    save: (file, name) => importConcept(file, name),
  },
]
