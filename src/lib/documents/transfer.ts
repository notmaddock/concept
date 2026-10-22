import { Doc } from 'yjs'
import type { LucideIcon } from 'lucide-react'
import { storageLocations } from './storage-locations'
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
  icon: LucideIcon
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
    ...storageLocations.device,
    kind: 'device',
  },
  {
    ...storageLocations.local,
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
          origin: storageLocations.local.label,
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
    ...storageLocations.local,
    save: (file, name) => importConcept(file, name),
  },
]
