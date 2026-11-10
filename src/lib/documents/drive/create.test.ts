import { beforeEach, expect, it, vi } from 'vitest'
import { createBlankDriveDocument, untitledDocumentName } from './create'

const api = vi.hoisted(() => ({
  createConceptFile: vi.fn(),
  DriveCreatedFileError: class extends Error {
    constructor(public readonly file: unknown) {
      super('created without an ETag')
    }
  },
}))

vi.mock('./api', () => api)
vi.mock('../initial-document', () => ({ initializeDocument: vi.fn() }))
vi.mock('../package', () => ({
  writePackage: vi.fn(async () => new Uint8Array([1, 2, 3])),
}))
vi.mock('../working', () => ({
  captureSnapshot: vi.fn(async (name: string) => ({
    name,
    update: new Uint8Array(),
    assets: [],
    requiredFeatures: [],
  })),
}))

const file = {
  id: 'file-1',
  name: 'Untitled document.concept',
  mimeType: 'application/vnd.concept+zip',
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('creates an empty Concept package in the requested folder', async () => {
  api.createConceptFile.mockResolvedValue({ file, etag: '"etag"' })
  await expect(
    createBlankDriveDocument({
      folderId: 'folder-1',
      folderResourceKey: 'folder-key',
    }),
  ).resolves.toBe(file)
  expect(api.createConceptFile).toHaveBeenCalledWith(
    untitledDocumentName,
    new Uint8Array([1, 2, 3]),
    'folder-1',
    'folder-key',
  )
})

it('uses the created file when Drive omits the upload ETag', async () => {
  api.createConceptFile.mockRejectedValue(new api.DriveCreatedFileError(file))
  await expect(createBlankDriveDocument()).resolves.toBe(file)
})
