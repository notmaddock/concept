import { Doc } from 'yjs'
import { initializeDocument } from '../initial-document'
import { writePackage } from '../package'
import { captureSnapshot } from '../working'
import { createConceptFile, DriveCreatedFileError } from './api'
import type { DriveFile } from './api'

export const untitledDocumentName = 'Untitled document'

export async function createBlankDriveDocument({
  name = untitledDocumentName,
  folderId = 'root',
  folderResourceKey,
}: {
  name?: string
  folderId?: string
  folderResourceKey?: string
} = {}): Promise<DriveFile> {
  const doc = new Doc()
  try {
    initializeDocument(doc)
    doc.getMap<string>('metadata').set('name', name)
    const snapshot = await captureSnapshot(name, doc)
    const content = await writePackage(snapshot)
    try {
      const { file } = await createConceptFile(
        name,
        content,
        folderId,
        folderResourceKey,
      )
      return file
    } catch (error) {
      if (error instanceof DriveCreatedFileError) return error.file
      throw error
    }
  } finally {
    doc.destroy()
  }
}
