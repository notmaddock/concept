import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { Doc, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SaveToDriveDialog } from './SaveToDriveDialog'
import { DriveCreatedFileError } from '#/lib/documents/drive/api'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  folders: vi.fn(),
  put: vi.fn(),
  open: vi.fn(),
  flush: vi.fn(),
  destroy: vi.fn(),
  metadata: vi.fn(),
}))
vi.mock('#/lib/documents/drive/auth', () => ({
  connectGoogleDrive: vi.fn(),
  getGoogleDriveToken: () => 'test-token',
  isGoogleDriveAuthError: () => false,
  isGoogleDriveConfigured: () => true,
  prepareGoogleDriveAuth: () => Promise.resolve(),
}))
vi.mock('#/lib/documents/drive/api', () => ({
  createConceptFile: mocks.create,
  listFolders: mocks.folders,
  getFileMetadata: mocks.metadata,
  DriveCreatedFileError: class extends Error {
    constructor(public readonly file: { id: string }) {
      super('File created but no ETag was returned.')
    }
  },
}))
vi.mock('#/lib/documents/storage', () => ({
  localDocumentStorage: { put: mocks.put, open: mocks.open },
}))

let root: Root
let container: HTMLDivElement
let doc: Doc
const onSaved = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  mocks.create.mockResolvedValue({
    file: { id: 'remote-id', version: '1' },
    etag: '"new"',
  })
  mocks.folders.mockResolvedValue([])
  mocks.put.mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.destroy.mockResolvedValue(undefined)
  mocks.open.mockReturnValue({
    whenSynced: Promise.resolve(),
    flush: mocks.flush,
    destroy: mocks.destroy,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  doc = new Doc()
  doc.get('root', XmlText).insert(0, 'Original content')
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  doc.destroy()
})

async function render() {
  await act(() =>
    root.render(
      <SaveToDriveDialog
        source={{ name: 'Original', doc }}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    ),
  )
}

async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent.trim() === label,
  )
  expect(button).toBeDefined()
  await act(() => button?.click())
}

it('saves in the selected folder and flushes the local copy before opening it', async () => {
  mocks.folders.mockResolvedValueOnce([{ id: 'folder-id', name: 'Projects' }])
  await render()
  await click('Projects')
  expect(mocks.folders).toHaveBeenLastCalledWith('folder-id')
  await click('Save in Projects')
  expect(mocks.create).toHaveBeenCalledWith(
    'Original',
    expect.stringContaining('"name":"Original"'),
    'folder-id',
  )
  expect(mocks.put).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'Gremote-id',
      drive: expect.objectContaining({
        offlineAvailable: false,
        dirty: false,
        etag: '"new"',
      }),
    }),
  )
  expect(mocks.flush).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'Gremote-id' }),
  )
})

it('retries local setup without creating a duplicate Drive file', async () => {
  mocks.put.mockRejectedValueOnce(new Error('Local storage is unavailable.'))
  await render()
  await click('Save in My Drive')
  expect(onSaved).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Local storage is unavailable.')
  await click('Open saved document')
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(onSaved).toHaveBeenCalledOnce()
})

it('keeps a missing-validator creation addressable and never creates it twice', async () => {
  mocks.create.mockRejectedValueOnce(
    new DriveCreatedFileError({
      id: 'already-created',
      name: 'Original.concept',
      mimeType: 'application/vnd.concept+json',
    }),
  )
  mocks.metadata.mockResolvedValue({ etag: '"recovered"' })
  await render()
  await click('Save in My Drive')
  expect(document.querySelector('a')?.href).toBe(
    'https://drive.google.com/file/d/already-created/view',
  )
  await click('Open saved document')
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.metadata).toHaveBeenCalledWith('already-created')
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'Galready-created' }),
  )
})
