import { Blob as NodeBlob } from 'node:buffer'
import { attachDocumentAssets } from '#/lib/documents/working'
import { describeAsset } from '#/lib/documents/assets'
import type { AssetRecord, AssetRepository } from '#/lib/documents/assets'
import { readPackage } from '#/lib/documents/package'
import { waitForAct } from '#/test/wait-for-act'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { Doc, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SaveToDriveDialog } from './SaveToDriveDialog'
import { DriveCreatedFileError } from '#/lib/documents/drive/api'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  folders: vi.fn(),
  put: vi.fn(),
  open: vi.fn(),
  flush: vi.fn(),
  destroy: vi.fn(),
  metadata: vi.fn(),
  importAssets: vi.fn(),
}))
vi.mock('#/lib/documents/drive/auth', () => ({
  connectGoogleDrive: vi.fn(),
  getGoogleDriveAccountId: () => 'test-account',
  isGoogleDriveConnected: () => true,
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
let sourceAssets: AssetRecord[]

function repository(
  documentId: string,
  assets: AssetRecord[] = [],
): AssetRepository {
  return {
    closed: false,
    documentId,
    async list() {
      return assets.map((asset) => asset.descriptor)
    },
    async get(id) {
      return assets.find((asset) => asset.descriptor.id === id)?.blob
    },
    async put(blob) {
      const descriptor = await describeAsset(blob)
      assets.push({ descriptor, blob })
      return descriptor
    },
    async importAssets(records) {
      await mocks.importAssets(records)
      assets.push(...records)
      return records.map((asset) => asset.descriptor)
    },
    pin: () => ({ release() {} }),
    async flush() {},
    subscribe: () => () => {},
    close() {},
  }
}
const onSaved = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  vi.stubGlobal('Blob', NodeBlob)
  sourceAssets = []
  mocks.importAssets.mockResolvedValue(undefined)
  mocks.create.mockResolvedValue({
    file: { id: 'remote-id', name: 'Original.concept', version: '1' },
    etag: '"new"',
  })
  mocks.folders.mockResolvedValue([])
  mocks.put.mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.destroy.mockResolvedValue(undefined)
  mocks.open.mockImplementation((id: string, target: Doc) => {
    expect(target.share.has('root')).toBe(false)
    attachDocumentAssets(target, repository(id))
    return {
      whenSynced: Promise.resolve(),
      flush: mocks.flush,
      destroy: mocks.destroy,
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  doc = new Doc()
  attachDocumentAssets(doc, repository('source', sourceAssets))
  doc.get('root', XmlText).insert(0, 'Original content')
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  doc.destroy()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(
      <SaveToDriveDialog
        source={{ name: 'Original', doc }}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    )
  })
}

async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent.trim() === label,
  )
  expect(button).toBeDefined()
  await act(async () => {
    button?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

it('saves in the selected folder and flushes the local copy before opening it', async () => {
  mocks.folders.mockResolvedValueOnce([{ id: 'folder-id', name: 'Projects' }])
  await render()
  await click('Projects')
  expect(mocks.folders).toHaveBeenLastCalledWith('folder-id')
  await click('Save in Projects')
  await waitForAct(() => {
    expect(onSaved).toHaveBeenCalledOnce()
  })
  expect(mocks.create).toHaveBeenCalledWith(
    'Original',
    expect.any(Uint8Array),
    'folder-id',
  )
  expect(mocks.put).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'Gremote-id',
      drive: expect.objectContaining({
        offlineAvailable: false,
        dirty: false,
        etag: '"new"',
        savedRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        remoteFilename: 'Original.concept',
      }),
    }),
  )
  expect(mocks.put.mock.calls[0][0]).toMatchObject({ importing: true })
  expect(mocks.put.mock.calls.at(-1)![0].importing).toBeUndefined()
  expect(mocks.put.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(
    mocks.flush.mock.invocationCallOrder[0],
  )
  expect(mocks.flush).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'Gremote-id' }),
  )
})

it('retries local setup without creating a duplicate Drive file', async () => {
  mocks.put
    .mockRejectedValueOnce(new Error('Local storage is unavailable.'))
    .mockRejectedValueOnce(new Error('Local storage is unavailable.'))
  await render()
  await click('Save in My Drive')
  await waitForAct(() => {
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
  expect(onSaved).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(toast.error).toHaveBeenCalledWith('Local storage is unavailable.', {
    id: 'save-to-drive',
  })
  expect(document.body.textContent).not.toContain(
    'Local storage is unavailable.',
  )
  await click('Open saved document')
  await waitForAct(() => {
    expect(toast.error).toHaveBeenCalledTimes(2)
  })
  await click('Open saved document')
  await waitForAct(() => {
    expect(onSaved).toHaveBeenCalledOnce()
  })
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
  await waitForAct(() => {
    expect(document.querySelector('a')).not.toBeNull()
  })
  expect(document.querySelector('a')?.href).toBe(
    'https://drive.google.com/file/d/already-created/view',
  )
  await click('Open saved document')
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.metadata).toHaveBeenCalledWith('already-created')
  await waitForAct(() => {
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'Galready-created',
        drive: expect.objectContaining({
          savedRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          remoteFilename: 'Original.concept',
        }),
      }),
    )
  })
})

it('falls back remoteFilename to undefined when remote file name is empty', async () => {
  mocks.create.mockResolvedValueOnce({
    file: { id: 'remote-empty-name', name: '', version: '1' },
    etag: '"new"',
  })
  await render()
  await click('Save in My Drive')
  await waitForAct(() => {
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'Gremote-empty-name',
        drive: expect.objectContaining({
          savedRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          remoteFilename: undefined,
        }),
      }),
    )
  })
})

it('includes retained binary assets in the uploaded package and commits them to the copied document', async () => {
  const blob = new Blob([new Uint8Array([0, 255, 128, 42])])
  const descriptor = await describeAsset(blob)
  sourceAssets.push({ descriptor, blob })
  await render()
  await click('Save in My Drive')
  await waitForAct(() => {
    expect(onSaved).toHaveBeenCalledOnce()
  })
  const uploaded = await readPackage(
    mocks.create.mock.calls[0][1] as Uint8Array,
  )
  if (uploaded.kind !== 'complete')
    throw new Error('Expected complete uploaded package')
  expect(uploaded.snapshot.assets.map((asset) => asset.descriptor)).toEqual([
    descriptor,
  ])
  expect(
    new Uint8Array(await uploaded.snapshot.assets[0].blob.arrayBuffer()),
  ).toEqual(new Uint8Array([0, 255, 128, 42]))
  expect(mocks.importAssets).toHaveBeenCalledWith([{ descriptor, blob }])
  expect(mocks.importAssets.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.flush.mock.invocationCallOrder[0],
  )
})
