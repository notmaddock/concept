import { subscribeToLibrary } from '../library-channel'
import type { DocumentStorage } from '../storage'
import { localMetadata } from './local-metadata'
import {
  openDocument,
  removeDocumentContent,
  withDocumentLock,
} from './local-content'

export { updateDocumentInfo } from './local-metadata'
export { persistDocumentUpdate, publishDocumentUpdate } from './local-content'

export const localDocumentStorage: DocumentStorage = {
  subscribe: subscribeToLibrary,
  list: localMetadata.list,
  get: localMetadata.get,
  create: localMetadata.create,
  async rename(id, name) {
    const trimmedName = name.trim()
    if (trimmedName.length > 1000)
      throw new Error('Document names must be 1,000 characters or fewer.')
    const document = await localMetadata.update(id, (current) => {
      if (!current) throw new Error('Document not found')
      return {
        ...current,
        name: trimmedName || 'Untitled document',
        updatedAt: Date.now(),
      }
    })
    return document!
  },
  async delete(id) {
    await withDocumentLock(id, async () => {
      if (!(await localMetadata.get(id))) throw new Error('Document not found')
      await removeDocumentContent(id)
      await localMetadata.delete(id)
    })
  },
  open: openDocument,
}
