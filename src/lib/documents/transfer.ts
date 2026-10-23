import { Doc } from 'yjs'
import type { ComponentType } from 'react'
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
  open?: () => Promise<DocumentInfo>
}

interface SourceInfo {
  id: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
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
  supportsSharing?: boolean
  save: (file: ConceptFile, name: string) => Promise<DocumentInfo>
}

export const documentSources: Array<DocumentSource> = [
  {
    ...storageLocations.drive,
    kind: 'library',
    async list() {
      const { listDrive } = await import('./drive/functions')
      return listDrive()
    },
    async read(document) {
      if (!document.backing) throw new Error('Missing backing file.')
      const { readDrive } = await import('./drive/functions')
      const remote = await readDrive({ data: document.backing })
      return {
        file: remote.file,
        filename: `${remote.document.name}.concept`,
        size: new Blob([JSON.stringify(remote.file)]).size,
        origin: storageLocations.drive.label,
        existingId: remote.document.id,
        open: () =>
          importConcept(remote.file, remote.document.name, remote.document),
      }
    },
  },
  {
    ...storageLocations.device,
    kind: 'device',
  },
  {
    ...storageLocations.local,
    kind: 'library',
    list: async () =>
      (await localDocumentStorage.list()).filter(
        (document) => !document.backing,
      ),
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
    ...storageLocations.drive,
    async save(file, name) {
      const { saveDrive } = await import('./drive/functions')
      const remote = await saveDrive({
        data: { id: crypto.randomUUID(), name, text: JSON.stringify(file) },
      })
      return importConcept(remote.file, name, remote.document)
    },
  },
  {
    ...storageLocations.local,
    save: (file, name) => importConcept(file, name),
  },
]
