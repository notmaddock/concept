import * as driveAuth from './drive/auth'
import type * as RealtimeModule from '../realtime/client'
import { RealtimeClient, realtimeOrigin } from '../realtime/client'
import type { PublicationTransport } from './publication'
import type * as DriveApi from './drive/api'
import { assetRetryPolicy } from './limits'
import {
  assetReferenceField,
  registerAssetReferenceCollector,
} from './references'
import { Blob as NodeBlob } from 'node:buffer'
import { readPackage, writePackage } from './package'
import { attachDocumentAssets } from './working'
import { describeAsset } from './assets'
import type { AssetRecord, AssetRepository } from './assets'
import {
  applyUpdate,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  XmlElement,
} from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { serializeConcept } from './serialization'
import { DocumentSync, documentSessions, getSaveStatus } from './sync'
import {
  DriveError,
  getFileMetadata,
  registerPublicDriveFile,
  readConceptFile,
  updateConceptFile,
} from './drive/api'
import type { DriveCapabilities } from './drive/api'
import type { DocumentInfo } from './storage'

const publicFiles = vi.hoisted(() => new Set<string>())

vi.mock('../realtime/client', async (importOriginal) => {
  const original = await importOriginal<typeof RealtimeModule>()
  return {
    ...original,
    RealtimeClient: vi.fn(
      class {
        constructor(
          readonly options: ConstructorParameters<
            typeof original.RealtimeClient
          >[0],
        ) {}
        start() {}
        stop() {}
        publish() {}
      },
    ),
  }
})

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('./drive/api', async (importOriginal) => ({
  ...(await importOriginal<typeof DriveApi>()),
  isPublicDriveFile: (id: string) => publicFiles.has(id),
  rememberPublicDriveFile: (id: string) => {
    publicFiles.add(id)
  },
  registerPublicDriveFile: vi.fn(async () => {}),
  readConceptFile: vi.fn(),
  getFileMetadata: vi.fn(),
  getDriveResourceKey: () => undefined,
  updateConceptFile: vi.fn(),
}))
vi.mock('./storage', () => ({
  localDocumentStorage: {
    patch: vi.fn(
      async (_id: string, update: (current: DocumentInfo) => DocumentInfo) => {
        info = update(info)
        return info
      },
    ),
  },
}))

let info: DocumentInfo
let local: Doc
let remote: Doc
let session: DocumentSync
let repository: AssetRepository
let records: Map<string, AssetRecord>
let unsubscribeAssets: () => void
let unregisterCollector: () => void
let previousRetryJitter: number
const read = vi.mocked(readConceptFile)
const metadata = vi.mocked(getFileMetadata)
const write = vi.mocked(updateConceptFile)
const flush = vi.fn(async () => {})

function version(etag: string) {
  return {
    etag,
    file: {
      id: 'drive-file',
      name: 'Test.concept',
      mimeType: 'application/vnd.concept+json',
      headRevisionId: etag,
      capabilities: {
        canDownload: true,
        canEdit: true,
        canModifyContent: true,
      } as DriveCapabilities,
    },
  }
}

function legacyBytes(name: string, doc: Doc) {
  return new Uint8Array(new TextEncoder().encode(serializeConcept(name, doc)))
}

async function mergePackage(doc: Doc, content: Uint8Array) {
  const result = await readPackage(content)
  if (result.kind !== 'complete')
    throw new Error('Expected complete saved package')
  applyUpdate(doc, result.snapshot.update)
}

async function start(publication?: PublicationTransport) {
  session = new DocumentSync(
    info,
    local,
    {
      whenSynced: Promise.resolve(),
      flush,
      destroy: async () => {},
    },
    publication,
  )
  await session.start()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(driveAuth, 'isGoogleDriveConnected').mockReturnValue(true)
  publicFiles.clear()
  vi.stubGlobal('Blob', NodeBlob)
  previousRetryJitter = assetRetryPolicy.jitter
  assetRetryPolicy.jitter = 0
  unregisterCollector = registerAssetReferenceCollector('test-asset', (node) =>
    assetReferenceField(node, '__assetId'),
  )
  records = new Map()
  const listeners = new Set<(id: AssetRecord['descriptor']['id']) => void>()
  repository = {
    closed: false,
    documentId: 'test',
    async put(blob) {
      const descriptor = await describeAsset(blob)
      records.set(descriptor.id, { descriptor, blob })
      listeners.forEach((listener) => listener(descriptor.id))
      return descriptor
    },
    async get(id) {
      return records.get(id)?.blob
    },
    async list() {
      return [...records.values()].map((record) => record.descriptor)
    },
    async importAssets(assets) {
      for (const asset of assets) {
        records.set(asset.descriptor.id, asset)
        listeners.forEach((listener) => listener(asset.descriptor.id))
      }
      return assets.map((asset) => asset.descriptor)
    },
    pin: () => ({ release() {} }),
    async flush() {},
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {},
  }
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.mocked(registerPublicDriveFile).mockReset().mockResolvedValue(undefined)
  info = {
    id: crypto.randomUUID(),
    name: 'Test',
    updatedAt: 0,
    drive: { fileId: 'drive-file', offlineAvailable: true },
  }
  remote = new Doc()
  remote.getMap('metadata').set('name', 'Test')
  remote.getText('root').insert(0, 'base')
  local = new Doc()
  applyUpdate(local, encodeStateAsUpdate(remote))
  unsubscribeAssets = attachDocumentAssets(local, repository)
  read.mockImplementation(async () => ({
    ...version('"base"'),
    content: legacyBytes('Test', remote),
  }))
  metadata.mockResolvedValue(version('"base"'))
  write.mockResolvedValue(version('"saved"'))
})

afterEach(async () => {
  await session.stop()
  unsubscribeAssets()
  unregisterCollector()
  assetRetryPolicy.jitter = previousRetryJitter
  vi.unstubAllGlobals()
  local.destroy()
  remote.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('waits for three idle seconds and does not write a clean document', async () => {
  await start()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(write).not.toHaveBeenCalled()
  local.getText('root').insert(4, ' local')
  await vi.advanceTimersByTimeAsync(2999)
  expect(write).not.toHaveBeenCalled()
  expect(getSaveStatus(info.id).phase).toBe('pending')
  await vi.advanceTimersByTimeAsync(1)
  expect(getSaveStatus(info.id).phase).toBe('saving')
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][3]).toBe('"base"')
  await session.sync()
  expect(getSaveStatus(info.id).phase).toBe('synced')
  metadata.mockResolvedValue(version('"saved"'))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(write).toHaveBeenCalledOnce()
})

it('forces a save at sixty seconds while edits keep resetting the idle timer', async () => {
  await start()
  local.getText('root').insert(0, '0')
  for (let second = 1; second < 60; second++) {
    await vi.advanceTimersByTimeAsync(1000)
    local.getText('root').insert(0, `${second}`)
  }
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(getSaveStatus(info.id).phase).toBe('saving')
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
})

it('checks only metadata when focus returns to an unchanged clean document', async () => {
  await start()
  read.mockClear()
  window.dispatchEvent(new Event('focus'))
  await session.sync()
  expect(metadata).toHaveBeenCalledExactlyOnceWith(
    'drive-file',
    expect.any(AbortSignal),
  )
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(getSaveStatus(info.id).phase).toBe('synced')
})

it('uploads local edits after an unchanged focus check without downloading content', async () => {
  await start()
  read.mockClear()
  local.getMap('settings').set('local-edit', true)
  await session.sync(true)
  expect(metadata).toHaveBeenCalledOnce()
  expect(read).not.toHaveBeenCalled()
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][3]).toBe('"base"')
  const saved = new Doc()
  await mergePackage(saved, write.mock.calls[0][2])
  expect(saved.getMap('settings').get('local-edit')).toBe(true)
  expect(getSaveStatus(info.id).phase).toBe('synced')
  saved.destroy()
})

it('reuses changed focus metadata while reconciling remote and local edits', async () => {
  await start()
  read.mockClear()
  local.getMap('settings').set('local-edit', true)
  remote.getMap('settings').set('remote-edit', true)
  const changed = version('"external-change"')
  metadata.mockResolvedValueOnce(changed)
  read.mockResolvedValueOnce({
    ...changed,
    content: legacyBytes('Test', remote),
  })
  await session.sync(true)
  expect(metadata).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledExactlyOnceWith(
    'drive-file',
    expect.any(AbortSignal),
    changed,
  )
  expect(write.mock.calls[0][3]).toBe(changed.etag)
  const saved = new Doc()
  await mergePackage(saved, write.mock.calls[0][2])
  expect(saved.getMap('settings').toJSON()).toEqual({
    'local-edit': true,
    'remote-edit': true,
  })
  saved.destroy()
})

it('merges remote changes and retries each stale ETag without losing local edits', async () => {
  await start()
  local.getMap('settings').set('local', true)
  remote.getMap('settings').set('remote', 'first')
  read.mockResolvedValueOnce({
    ...version('"remote-1"'),
    content: legacyBytes('Test', remote),
  })
  remote.getMap('settings').set('another', 'second')
  read.mockResolvedValueOnce({
    ...version('"remote-2"'),
    content: legacyBytes('Test', remote),
  })
  write
    .mockRejectedValueOnce(new DriveError(412, 'conflict'))
    .mockRejectedValueOnce(new DriveError(412, 'conflict'))
  await session.sync()
  expect(write.mock.calls.map((call) => call[3])).toEqual([
    '"base"',
    '"remote-1"',
    '"remote-2"',
  ])
  const saved = new Doc()
  await mergePackage(saved, write.mock.calls[2][2])
  expect(saved.getMap('settings').toJSON()).toEqual({
    local: true,
    remote: 'first',
    another: 'second',
  })
  expect(local.getMap('settings').toJSON()).toEqual(
    saved.getMap('settings').toJSON(),
  )
  expect(getSaveStatus(info.id).phase).toBe('synced')
  saved.destroy()
})

it('keeps edits made during upload pending until a later conditional upload', async () => {
  await start()
  local.getMap('settings').set('first', true)
  const uploading = deferred<ReturnType<typeof version>>()
  const entered = deferred<void>()
  write.mockImplementationOnce(() => {
    entered.resolve()
    return uploading.promise
  })
  const saving = session.sync()
  await entered.promise
  local.getMap('settings').set('during-upload', true)
  uploading.resolve(version('"first-save"'))
  await saving
  expect(getSaveStatus(info.id).phase).toBe('pending')
  expect(write).toHaveBeenCalledOnce()
  metadata.mockResolvedValue(version('"first-save"'))
  await vi.advanceTimersByTimeAsync(3000)
  expect(getSaveStatus(info.id).phase).toBe('saving')
  await session.sync()
  expect(write).toHaveBeenCalledTimes(2)
  expect(write.mock.calls[1][3]).toBe('"first-save"')
  const saved = new Doc()
  await mergePackage(saved, write.mock.calls[1][2])
  expect(saved.getMap('settings').get('during-upload')).toBe(true)
  saved.destroy()
})

it('uploads deletion-only changes even when the Yjs state vector is unchanged', async () => {
  await start()
  const before = encodeStateVector(local)
  local.getText('root').delete(0, 4)
  expect(encodeStateVector(local)).toEqual(before)
  await vi.advanceTimersByTimeAsync(3000)
  expect(getSaveStatus(info.id).phase).toBe('saving')
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
  const saved = new Doc()
  await mergePackage(saved, write.mock.calls[0][2])
  expect(saved.getText('root').toString()).toBe('')
  saved.destroy()
})

it('stops timers, event-triggered reads, and document subscriptions', async () => {
  await start()
  local.getMap('settings').set('pending', true)
  await session.stop()
  expect(documentSessions.has(info.id)).toBe(false)
  local.getMap('settings').set('after-stop', true)
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(read).toHaveBeenCalledOnce()
  expect(metadata).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})

it('keeps an edit pending when it arrives during the final clean-sync flush', async () => {
  await start()
  const finishing = deferred<void>()
  const entered = deferred<void>()
  flush.mockImplementationOnce(() => {
    entered.resolve()
    return finishing.promise
  })
  const checking = session.sync(true)
  await entered.promise
  local.getMap('settings').set('during-final-flush', true)
  finishing.resolve()
  await checking
  expect(getSaveStatus(info.id).phase).toBe('pending')
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(3000)
  expect(getSaveStatus(info.id).phase).toBe('saving')
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
})

it('adopts an external Drive filename even when the embedded name is older', async () => {
  await start()
  const renamed = version('"renamed"')
  renamed.file.name = 'External name.concept'
  metadata.mockResolvedValueOnce(renamed)
  read.mockResolvedValueOnce({
    ...renamed,
    content: legacyBytes('Test', remote),
  })
  write.mockResolvedValueOnce(renamed)
  await session.sync(true)
  expect(local.getMap('metadata').get('name')).toBe('External name')
  expect(info.name).toBe('External name')
  expect(info.drive?.remoteFilename).toBe('External name.concept')
  expect(write.mock.calls[0][1]).toBe('External name')
  expect(write.mock.calls[0][4]).toBe('External name.concept')
})

it('preserves a pending app rename across a remote check and renames the Drive file', async () => {
  await start()
  local.getMap('metadata').set('name', 'App name')
  const renamed = version('"app-renamed"')
  renamed.file.name = 'App name.concept'
  write.mockResolvedValueOnce(renamed)
  await session.sync(true)
  expect(local.getMap('metadata').get('name')).toBe('App name')
  expect(info.name).toBe('App name')
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][1]).toBe('App name')
  expect(write.mock.calls[0][4]).toBeUndefined()
  expect(info.drive?.remoteFilename).toBe('App name.concept')
})

it('shows a toast and retains a pending rename when Drive rejects it', async () => {
  await start()
  local.getMap('metadata').set('name', 'Pending name')
  write.mockRejectedValueOnce(new DriveError(403, 'Read only'))
  await session.sync()
  expect(toast.error).toHaveBeenCalledWith(
    'Could not rename the file on Google Drive.',
    { id: `drive-rename:${info.id}` },
  )
  expect(local.getMap('metadata').get('name')).toBe('Pending name')
  expect(info.drive?.dirty).toBe(true)
  expect(getSaveStatus(info.id).phase).toBe('error')
})

it('detects read-only capabilities on download and propagates readOnly to DocumentInfo', async () => {
  const roVersion = version('"ro-version"')
  roVersion.file.capabilities = {
    canDownload: true,
    canEdit: false,
    canModifyContent: false,
  }
  read.mockResolvedValueOnce({
    ...roVersion,
    content: legacyBytes(info.name, remote),
  })

  await start()

  expect(info.readOnly).toBe(true)
  expect(info.drive?.readOnly).toBe(true)
  expect(getSaveStatus(info.id).readOnly).toBe(true)
  expect(getSaveStatus(info.id).phase).toBe('synced')
})

it('does not mark dirty or attempt upload when local doc is modified in read-only mode', async () => {
  info.readOnly = true
  info.drive = { ...info.drive!, readOnly: true }
  const readonly = version('"base"')
  readonly.file.capabilities = {
    canDownload: true,
    canEdit: false,
    canModifyContent: false,
  }
  read.mockResolvedValue({ ...readonly, content: legacyBytes('Test', remote) })
  metadata.mockResolvedValue(readonly)
  await start()

  local.getMap('settings').set('theme', 'dark')
  expect(getSaveStatus(info.id).readOnly).toBe(true)
  expect(info.drive.dirty).toBe(false)

  await vi.advanceTimersByTimeAsync(5000)
  expect(write).not.toHaveBeenCalled()

  await session.sync(true)
  expect(write).not.toHaveBeenCalled()
})

it('preserves unsynced edits after Drive access becomes view-only', async () => {
  info.drive!.offlineAvailable = false
  await start()
  local.getMap('settings').set('unsynced-edit', 'recover me')
  const readonly = version('"view-only"')
  readonly.file.capabilities = { canDownload: true, canEdit: false }
  metadata.mockResolvedValue(readonly)
  read.mockResolvedValue({
    ...readonly,
    content: legacyBytes(info.name, remote),
  })

  await session.sync(true)

  expect(write).not.toHaveBeenCalled()
  expect(local.getMap('settings').get('unsynced-edit')).toBe('recover me')
  expect(info).toMatchObject({ readOnly: true, drive: { dirty: true } })
  expect(getSaveStatus(info.id)).toMatchObject({
    phase: 'error',
    readOnly: true,
  })
  expect(getSaveStatus(info.id).error).toContain('preserved in this browser')
  await vi.advanceTimersByTimeAsync(120_000)
  expect(write).not.toHaveBeenCalled()
})

it('retains recoverable cached edits when reopening a view-only document', async () => {
  info.readOnly = true
  info.drive = { ...info.drive!, readOnly: true, dirty: true }
  local.getMap('settings').set('cached-edit', 'recover me')
  const readonly = version('"view-only"')
  readonly.file.capabilities = { canDownload: true, canEdit: false }
  read.mockResolvedValue({
    ...readonly,
    content: legacyBytes(info.name, remote),
  })

  await start()

  expect(info.drive.dirty).toBe(true)
  expect(local.getMap('settings').get('cached-edit')).toBe('recover me')
  expect(getSaveStatus(info.id).phase).toBe('error')
  expect(write).not.toHaveBeenCalled()
})

it('detects permissions changing without a content ETag change', async () => {
  await start()
  const readonly = version('"base"')
  readonly.file.capabilities = { canDownload: true, canEdit: false }
  metadata.mockResolvedValue(readonly)
  read.mockResolvedValue({
    ...readonly,
    content: legacyBytes(info.name, remote),
  })

  await session.sync(true)

  expect(info.readOnly).toBe(true)
  expect(getSaveStatus(info.id).readOnly).toBe(true)

  const editable = version('"base"')
  editable.file.capabilities = {
    canDownload: true,
    canEdit: true,
    canModifyContent: true,
  }
  metadata.mockResolvedValue(editable)
  read.mockResolvedValue({
    ...editable,
    content: legacyBytes(info.name, remote),
  })
  await session.sync(true)

  expect(info.readOnly).toBe(false)
  expect(getSaveStatus(info.id).readOnly).toBe(false)
})

async function assetRecord(text: string): Promise<AssetRecord> {
  const blob = new Blob([text])
  return { blob, descriptor: await describeAsset(blob) }
}

function referenceAsset(record: AssetRecord) {
  const node = new XmlElement('test-asset')
  node.setAttribute('__type', 'test-asset')
  node.setAttribute('__assetId', record.descriptor.id)
  local.getText('root').insertEmbed(0, node)
  return node
}

function packageBytes(doc: Doc, assets: ReadonlyArray<AssetRecord>) {
  return writePackage({
    name: 'Test',
    update: encodeStateAsUpdate(doc),
    assets: [...assets],
    requiredFeatures: [],
  })
}

it('unions retained inventories through conflict retries, including unreferenced imported assets', async () => {
  const localAsset = await assetRecord('local attachment')
  const firstRemoteAsset = await assetRecord('remote attachment')
  const conflictAsset = await assetRecord('concurrent attachment')
  records.set(localAsset.descriptor.id, localAsset)
  read.mockResolvedValueOnce({
    ...version('"base"'),
    content: await packageBytes(remote, [firstRemoteAsset]),
  })
  await start()
  local.getMap('settings').set('local-edit', true)
  remote.getMap('settings').set('remote-edit', true)
  read.mockResolvedValueOnce({
    ...version('"conflict"'),
    content: await packageBytes(remote, [firstRemoteAsset, conflictAsset]),
  })
  write.mockRejectedValueOnce(new DriveError(412, 'conflict'))
  await session.sync()
  expect(write).toHaveBeenCalledTimes(2)
  const result = await readPackage(write.mock.calls[1][2])
  expect(result.kind).toBe('complete')
  if (result.kind !== 'complete') throw new Error('Expected complete package')
  expect(
    result.snapshot.assets.map((asset) => asset.descriptor.id).sort(),
  ).toEqual(
    [localAsset, firstRemoteAsset, conflictAsset]
      .map((asset) => asset.descriptor.id)
      .sort(),
  )
  const saved = new Doc()
  applyUpdate(saved, result.snapshot.update)
  expect(saved.getMap('settings').toJSON()).toEqual({
    'local-edit': true,
    'remote-edit': true,
  })
  saved.destroy()
})

it('does not acknowledge an asset replacement that occurs during an older upload', async () => {
  const original = await assetRecord('original bytes')
  const replacement = await assetRecord('replacement bytes')
  await start()
  records.set(original.descriptor.id, original)
  const node = referenceAsset(original)
  const uploading = deferred<ReturnType<typeof version>>()
  const entered = deferred<void>()
  write.mockImplementationOnce(() => {
    entered.resolve()
    return uploading.promise
  })
  const saving = session.sync()
  await entered.promise
  records.set(replacement.descriptor.id, replacement)
  node.setAttribute('__assetId', replacement.descriptor.id)
  uploading.resolve(version('"first-save"'))
  await saving
  expect(getSaveStatus(info.id).phase).toBe('pending')
  const first = await readPackage(write.mock.calls[0][2])
  if (first.kind !== 'complete') throw new Error('Expected complete package')
  expect(first.snapshot.assets.map((asset) => asset.descriptor.id)).toEqual([
    original.descriptor.id,
  ])
  await session.sync()
  const second = await readPackage(write.mock.calls[1][2])
  if (second.kind !== 'complete') throw new Error('Expected complete package')
  expect(
    second.snapshot.assets.map((asset) => asset.descriptor.id).sort(),
  ).toEqual([original.descriptor.id, replacement.descriptor.id].sort())
  expect(getSaveStatus(info.id).phase).toBe('synced')
})

it('preserves missing references and unrelated text locally without overwriting complete remote bytes', async () => {
  await start()
  const unavailable = await assetRecord('not published yet')
  referenceAsset(unavailable)
  local.getMap('settings').set('unrelated-text-edit', 'keep locally')
  await session.sync()
  expect(write).not.toHaveBeenCalled()
  expect(getSaveStatus(info.id).phase).toBe('missing-assets')
  expect(info.drive?.dirty).toBe(true)
  expect(toast.error).not.toHaveBeenCalled()
  expect(local.getMap('settings').get('unrelated-text-edit')).toBe(
    'keep locally',
  )
  expect(local.getText('root').toDelta()[0].insert).toBeInstanceOf(XmlElement)
  await expect(session.setOfflineAvailable(true)).rejects.toMatchObject({
    code: 'incomplete-assets',
  })
})

it('recovers missing assets from a newer package before publishing pending text', async () => {
  await start()
  const arriving = await assetRecord('remote publication completed')
  referenceAsset(arriving)
  local.getMap('settings').set('local-edit', true)
  const published = version('"published"')
  metadata.mockResolvedValue(published)
  read.mockResolvedValue({
    ...published,
    content: await packageBytes(remote, [arriving]),
  })
  await session.sync()
  expect(read).toHaveBeenCalledTimes(2)
  expect(records.has(arriving.descriptor.id)).toBe(true)
  expect(write).toHaveBeenCalled()
  expect(getSaveStatus(info.id).phase).toBe('synced')
})

it('recovers multiple missing references in one foreground package check when publication hints are absent', async () => {
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible')
  try {
    await start()
    const first = await assetRecord('first late publication')
    const second = await assetRecord('second late publication')
    referenceAsset(first)
    referenceAsset(second)
    await session.sync()
    expect(write).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(2)
    const published = version('"late-publication"')
    metadata.mockResolvedValue(published)
    read.mockResolvedValue({
      ...published,
      content: await packageBytes(remote, [first, second]),
    })
    await vi.advanceTimersByTimeAsync(assetRetryPolicy.initialMs - 1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await session.sync()
    expect(read).toHaveBeenCalledTimes(3)
    expect(records.has(first.descriptor.id)).toBe(true)
    expect(records.has(second.descriptor.id)).toBe(true)
    expect(getSaveStatus(info.id).phase).toBe('synced')
  } finally {
    visibility.mockRestore()
  }
})

it('pauses automatic missing-asset checks while hidden and wakes on visibility recovery', async () => {
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible')
  try {
    await start()
    const arriving = await assetRecord('available after returning to tab')
    referenceAsset(arriving)
    await session.sync()
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    metadata.mockClear()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(metadata).not.toHaveBeenCalled()
    const published = version('"while-hidden"')
    metadata.mockResolvedValue(published)
    read.mockResolvedValue({
      ...published,
      content: await packageBytes(remote, [arriving]),
    })
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await session.sync()
    expect(records.has(arriving.descriptor.id)).toBe(true)
    expect(getSaveStatus(info.id).phase).toBe('synced')
  } finally {
    visibility.mockRestore()
  }
})

it('polls for a reference received while view-only without attempting a publication', async () => {
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible')
  try {
    const readonly = version('"view-only"')
    readonly.file.capabilities = { canDownload: true, canEdit: false }
    read.mockResolvedValueOnce({
      ...readonly,
      content: legacyBytes('Test', remote),
    })
    await start()
    const arriving = await assetRecord('readonly late asset')
    referenceAsset(arriving)
    const published = version('"readonly-publication"')
    published.file.capabilities = { canDownload: true, canEdit: false }
    metadata.mockResolvedValue(published)
    read.mockResolvedValue({
      ...published,
      content: await packageBytes(remote, [arriving]),
    })
    await vi.advanceTimersByTimeAsync(assetRetryPolicy.initialMs)
    await session.sync()
    expect(read).toHaveBeenCalledTimes(2)
    expect(records.has(arriving.descriptor.id)).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(info.readOnly).toBe(true)
  } finally {
    visibility.mockRestore()
  }
})

it('reconciles a committed upload whose response was lost before deciding whether to upload again', async () => {
  await start()
  local.getMap('settings').set('committed-before-response-loss', true)
  write.mockImplementationOnce(async (_id, _name, content) => {
    await mergePackage(remote, content)
    const committed = version('"committed"')
    metadata.mockResolvedValue(committed)
    read.mockResolvedValue({
      ...committed,
      content: await packageBytes(remote, []),
    })
    throw new TypeError('Connection lost after commit')
  })
  await session.sync()
  expect(getSaveStatus(info.id).phase).toBe('error')
  expect(info.drive?.dirty).toBe(true)
  await vi.advanceTimersByTimeAsync(1000)
  await session.sync()
  expect(read).toHaveBeenCalledTimes(2)
  expect(write).toHaveBeenCalledOnce()
  expect(getSaveStatus(info.id).phase).toBe('synced')
  expect(info.drive?.etag).toBe('"committed"')
  expect(info.drive?.dirty).toBe(false)
})

it('ignores a late downloaded package after the owning session has stopped', async () => {
  await start()
  remote.getMap('settings').set('late-remote-edit', true)
  const arriving = await assetRecord('late remote bytes')
  const changed = version('"late-download"')
  metadata.mockResolvedValue(changed)
  const download = deferred<Awaited<ReturnType<typeof readConceptFile>>>()
  const entered = deferred<void>()
  read.mockImplementationOnce(() => {
    entered.resolve()
    return download.promise
  })
  const syncing = session.sync(true)
  await entered.promise
  const stopping = session.stop()
  download.resolve({
    ...changed,
    content: await packageBytes(remote, [arriving]),
  })
  await syncing
  await stopping
  expect(local.getMap('settings').has('late-remote-edit')).toBe(false)
  expect(records.has(arriving.descriptor.id)).toBe(false)
  expect(write).not.toHaveBeenCalled()
  expect(getSaveStatus(info.id)).toEqual({ phase: 'loading' })
})

it('does not publish a package when the session closes while resolving its captured assets', async () => {
  await start()
  const retained = await assetRecord('pin until capture completes')
  records.set(retained.descriptor.id, retained)
  local.getMap('settings').set('pending-local-edit', true)
  const lookup = deferred<Blob | undefined>()
  const entered = deferred<void>()
  const get = repository.get
  repository.get = async (id) => {
    entered.resolve()
    return id === retained.descriptor.id ? lookup.promise : get(id)
  }
  const saving = session.sync()
  await entered.promise
  const stopping = session.stop()
  lookup.resolve(retained.blob)
  await saving
  await stopping
  expect(write).not.toHaveBeenCalled()
  expect(info.drive?.dirty).toBe(true)
  expect(getSaveStatus(info.id)).toEqual({ phase: 'loading' })
})

it('uses foreground asset polling instead of rapid network retries after missing-asset recovery fails', async () => {
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible')
  try {
    await start()
    const arriving = await assetRecord('published after temporary failure')
    referenceAsset(arriving)
    read.mockRejectedValueOnce(
      new DriveError(503, 'Drive temporarily unavailable'),
    )
    await session.sync()
    expect(read).toHaveBeenCalledTimes(2)
    expect(write).not.toHaveBeenCalled()
    expect(info.drive?.dirty).toBe(true)
    const published = version('"after-failure"')
    metadata.mockResolvedValue(published)
    read.mockResolvedValue({
      ...published,
      content: await packageBytes(remote, [arriving]),
    })
    metadata.mockClear()
    await vi.advanceTimersByTimeAsync(assetRetryPolicy.initialMs - 1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(metadata).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await session.sync()
    expect(read).toHaveBeenCalledTimes(3)
    expect(records.has(arriving.descriptor.id)).toBe(true)
    expect(getSaveStatus(info.id).phase).toBe('synced')
  } finally {
    visibility.mockRestore()
  }
})

it('leaves explicit recovery failures to the calling action to report once', async () => {
  await start()
  referenceAsset(await assetRecord('unavailable during export'))
  read.mockRejectedValueOnce(
    new DriveError(503, 'Drive temporarily unavailable'),
  )
  await expect(session.recoverAssets()).rejects.toMatchObject({
    code: 'incomplete-assets',
  })
  expect(toast.error).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(info.drive?.dirty).toBe(true)
})

it('quarantines unsynced edits on downgrade even if write access returns later', async () => {
  await start()
  local.getMap('settings').set('unsynced', true)
  const viewer = version('"base"')
  viewer.file.capabilities = {
    canDownload: true,
    canEdit: false,
    canModifyContent: false,
  }
  metadata.mockResolvedValue(viewer)
  read.mockResolvedValue({ ...viewer, content: legacyBytes('Test', remote) })
  await session.sync(true)
  expect(info.drive?.quarantined).toBe(true)
  const editor = version('"base"')
  editor.file.capabilities = {
    canDownload: true,
    canEdit: true,
    canModifyContent: true,
  }
  metadata.mockResolvedValue(editor)
  read.mockResolvedValue({ ...editor, content: legacyBytes('Test', remote) })
  await session.sync(true)
  expect(write).not.toHaveBeenCalled()
  expect(local.getMap('settings').get('unsynced')).toBe(true)
})

it('retains an unavailable access status after the editor session is detached', async () => {
  await start()
  metadata.mockRejectedValue(new DriveError(404, 'File unavailable'))
  await session.sync(true)
  expect(getSaveStatus(info.id).access?.kind).toBe('unavailable')
  expect(session.isReadOnly).toBe(true)
  await session.stop()
  expect(getSaveStatus(info.id).access?.kind).toBe('unavailable')
})

it('ignores an older successful permission response after a newer downgrade', async () => {
  await start()
  const late = deferred<ReturnType<typeof version>>()
  metadata.mockImplementationOnce(() => late.promise)
  for (let second = 0; second < 30; second++) {
    local.getMap('settings').set('typing', second)
    await vi.advanceTimersByTimeAsync(1000)
  }
  const viewer = version('"base"')
  viewer.file.capabilities = {
    canDownload: true,
    canEdit: false,
    canModifyContent: false,
  }
  metadata.mockResolvedValue(viewer)
  read.mockResolvedValue({ ...viewer, content: legacyBytes('Test', remote) })
  await session.sync(true)
  late.resolve(version('"base"'))
  await vi.advanceTimersByTimeAsync(0)
  expect(session.access.kind).toBe('viewer')
  expect(write).not.toHaveBeenCalled()
})

it('blocks content when download permission changes without changing the ETag', async () => {
  await start()
  const restricted = version('"base"')
  restricted.file.capabilities = {
    canDownload: false,
    canEdit: true,
    canModifyContent: true,
  }
  metadata.mockResolvedValue(restricted)
  await session.sync(true)
  expect(session.access.kind).toBe('unavailable')
  expect(getSaveStatus(info.id).readOnly).toBe(true)
  expect(write).not.toHaveBeenCalled()
})

it('never applies a downloaded package after the signed-in account changes', async () => {
  const auth = await import('./drive/auth')
  const account = vi
    .spyOn(auth, 'getGoogleDriveAccountId')
    .mockReturnValue(undefined)
  const pending = deferred<Awaited<ReturnType<typeof readConceptFile>>>()
  read.mockReturnValue(pending.promise)
  remote.getMap('settings').set('new-account-data', true)
  const starting = start()
  try {
    await vi.advanceTimersByTimeAsync(0)
    account.mockReturnValue('another-account')
    pending.resolve({
      ...version('"base"'),
      content: legacyBytes('Test', remote),
    })
    await expect(starting).rejects.toThrow('different Google account')
    expect(local.getMap('settings').has('new-account-data')).toBe(false)
    expect(session.access.kind).toBe('unavailable')
  } finally {
    account.mockRestore()
  }
})

it('persists realtime edits locally without starting the local idle Drive save timer', async () => {
  await start()
  flush.mockClear()
  local.transact(
    () => local.getMap('settings').set('peer', true),
    realtimeOrigin,
  )
  await vi.advanceTimersByTimeAsync(2999)
  expect(flush).toHaveBeenCalled()
  expect(info.drive?.dirty).toBe(true)
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(metadata).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(57_000)
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
  const saved = new Doc()
  try {
    await mergePackage(saved, write.mock.calls[0][2])
    expect(saved.getMap('settings').get('peer')).toBe(true)
  } finally {
    saved.destroy()
  }
})

it('keeps local idle saving independent from further realtime typing', async () => {
  await start()
  local.getMap('settings').set('local', true)
  for (let second = 0; second < 3; second++) {
    local.transact(
      () => local.getMap('settings').set('peer', second),
      realtimeOrigin,
    )
    await vi.advanceTimersByTimeAsync(1000)
  }
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
})

it('coalesces websocket and local publication hints without republishing remote-only changes', async () => {
  const listeners = new Set<Parameters<PublicationTransport['subscribe']>[0]>()
  await start({
    publish: vi.fn(),
    close: vi.fn(),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  })
  const options = vi.mocked(RealtimeClient).mock.calls[0][0]
  const published = version('"published"')
  const notify = () => {
    options.onPublication()
    for (const listener of listeners)
      listener({
        protocol: 1,
        storage: 'google-drive',
        fileId: info.drive!.fileId,
        validator: published.etag,
        revision: 'a'.repeat(64),
      })
  }
  local.transact(
    () => local.getMap('settings').set('peer', true),
    realtimeOrigin,
  )
  for (let second = 0; second < 29; second++) {
    notify()
    await vi.advanceTimersByTimeAsync(1000)
  }
  expect(metadata).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
  metadata.mockResolvedValue(published)
  read.mockResolvedValue({ ...published, content: legacyBytes('Test', remote) })
  notify()
  await vi.advanceTimersByTimeAsync(1000)
  expect(metadata).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledTimes(2)
  expect(write).not.toHaveBeenCalled()
  // A publication containing an already observed validator adds no HTTP work.
  for (const listener of listeners)
    listener({
      protocol: 1,
      storage: 'google-drive',
      fileId: info.drive!.fileId,
      validator: published.etag,
      revision: 'a'.repeat(64),
    })
  await vi.advanceTimersByTimeAsync(5000)
  expect(metadata).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
})

it('does not turn downloaded asset imports into urgent Drive publications or realtime echoes', async () => {
  await start()
  const imported = await assetRecord('new package asset')
  const origins: unknown[] = []
  local.on('update', (_update, origin) => origins.push(origin))
  remote.getMap('settings').set('published', true)
  metadata.mockResolvedValue(version('"published"'))
  read.mockResolvedValue({
    ...version('"published"'),
    content: await packageBytes(remote, [imported]),
  })
  await session.sync(true)
  await vi.advanceTimersByTimeAsync(5000)
  expect(write).not.toHaveBeenCalled()
  expect(metadata).toHaveBeenCalledOnce()
  expect(origins.length).toBeGreaterThan(0)
  expect(origins.every((origin) => origin === realtimeOrigin)).toBe(true)
  expect(records.has(imported.descriptor.id)).toBe(true)
})

it('keeps a bounded fallback deadline while realtime typing and publication hints continue', async () => {
  await start()
  const options = vi.mocked(RealtimeClient).mock.calls[0][0]
  for (let second = 0; second < 60; second++) {
    local.transact(
      () => local.getMap('settings').set('peer', second),
      realtimeOrigin,
    )
    options.onPublication()
    await vi.advanceTimersByTimeAsync(1000)
    if (second < 59) expect(write).not.toHaveBeenCalled()
  }
  await session.sync()
  expect(write).toHaveBeenCalledOnce()
  expect(metadata).toHaveBeenCalledTimes(2)
})

it('checks an image publication sooner while preserving the no-upload watcher policy', async () => {
  await start()
  const asset = await assetRecord('image published by peer')
  local.transact(() => referenceAsset(asset), realtimeOrigin)
  await vi.advanceTimersByTimeAsync(0)
  const published = version('"with-image"')
  metadata.mockResolvedValue(published)
  read.mockResolvedValue({
    ...published,
    content: await packageBytes(remote, [asset]),
  })
  vi.mocked(RealtimeClient).mock.calls[0][0].onPublication()
  await vi.advanceTimersByTimeAsync(4999)
  expect(metadata).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(metadata).toHaveBeenCalledOnce()
  await session.sync()
  expect(records.has(asset.descriptor.id)).toBe(true)
  expect(write).not.toHaveBeenCalled()
})

it('saves an anonymous public edit without requiring a Google account connection', async () => {
  vi.mocked(driveAuth.isGoogleDriveConnected).mockReturnValue(false)
  info.drive!.publicAccess = true
  await start()
  local.getMap('settings').set('anonymous-edit', true)
  await session.sync()
  expect(publicFiles.has(info.drive!.fileId)).toBe(true)
  expect(registerPublicDriveFile).not.toHaveBeenCalled()
  expect(write).toHaveBeenCalledOnce()
  expect(getSaveStatus(info.id).phase).toBe('synced')
  expect(info.drive?.publicAccess).toBe(true)
})

it('keeps public publisher credential failures separate from the anonymous visitor account', async () => {
  vi.mocked(driveAuth.isGoogleDriveConnected).mockReturnValue(false)
  info.drive!.publicAccess = true
  read.mockRejectedValueOnce(new DriveError(401, 'Publisher unavailable'))
  await start()
  expect(getSaveStatus(info.id).phase).toBe('error')
  expect(session.access).toMatchObject({
    kind: 'unverified',
    reason: 'temporary',
  })
})

it('registers an authenticated publisher independently of realtime and tolerates private-file denial', async () => {
  const auth = await import('./drive/auth')
  const connected = vi
    .spyOn(auth, 'isGoogleDriveConnected')
    .mockReturnValue(true)
  vi.mocked(registerPublicDriveFile).mockRejectedValueOnce(
    new DriveError(403, 'Private file'),
  )
  try {
    await start()
    expect(registerPublicDriveFile).toHaveBeenCalledExactlyOnceWith(
      info.drive!.fileId,
      expect.any(AbortSignal),
    )
    expect(getSaveStatus(info.id).phase).toBe('synced')
    expect(toast.error).not.toHaveBeenCalled()
  } finally {
    connected.mockRestore()
  }
})

it('stops scheduled reconciliation and remote-save fallback after confirmed access loss', async () => {
  await start()
  local.transact(
    () => local.getMap('settings').set('peer', true),
    realtimeOrigin,
  )
  metadata.mockRejectedValue(new DriveError(404, 'Access unavailable'))
  await session.sync(true)
  await vi.advanceTimersByTimeAsync(60_000)
  await session.sync(true)
  expect(metadata).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
  expect(session.access.kind).toBe('unavailable')
})

it('retains a private offline copy after authentication expiry without attempting anonymous access', async () => {
  vi.mocked(driveAuth.isGoogleDriveConnected).mockReturnValue(false)
  await start()
  expect(local.getText('root').toString()).toBe('base')
  expect(session.access).toMatchObject({
    kind: 'unverified',
    reason: 'authentication',
  })
  expect(getSaveStatus(info.id).phase).toBe('auth-required')
  expect(session.isReadOnly).toBe(false)
  await session.sync(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).not.toHaveBeenCalled()
  expect(metadata).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(session.access.kind).toBe('unverified')
})

it('does not bind an anonymous socket grant to the remembered offline account identity', async () => {
  info.drive!.accountId = 'remembered-account'
  info.drive!.publicAccess = true
  const account = vi
    .spyOn(driveAuth, 'getGoogleDriveAccountId')
    .mockReturnValue('remembered-account')
  vi.mocked(driveAuth.isGoogleDriveConnected).mockReturnValue(false)
  try {
    await start()
    expect(vi.mocked(RealtimeClient).mock.calls[0][0].accountId).toBeUndefined()
    expect(session.access.kind).toBe('editor')
  } finally {
    account.mockRestore()
  }
})

it('starts realtime and exposes the session without waiting for publisher registration', async () => {
  const registration = deferred<void>()
  vi.mocked(registerPublicDriveFile).mockReturnValueOnce(registration.promise)
  const ready = vi.fn()
  const starting = start().then(ready)
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  expect(documentSessions.get(info.id)).toBe(session)
  expect(session.realtime).toBeDefined()
  expect(getSaveStatus(info.id).phase).toBe('synced')
  registration.resolve()
  await starting
})

it('reports a publisher registration failure once while leaving document editing ready', async () => {
  vi.mocked(registerPublicDriveFile).mockRejectedValueOnce(
    new DriveError(503, 'Unavailable'),
  )
  await start()
  await Promise.resolve()
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    'Could not enable anonymous access. Reopen the document to try again.',
    { id: `drive-sharing:${info.id}` },
  )
  expect(getSaveStatus(info.id).phase).toBe('synced')
  expect(documentSessions.get(info.id)).toBe(session)
})

it('ignores a publisher registration failure after its document session closes', async () => {
  let fail!: (reason: unknown) => void
  vi.mocked(registerPublicDriveFile).mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      fail = reject
    }),
  )
  await start()
  await session.stop()
  expect(vi.mocked(registerPublicDriveFile).mock.calls[0][1]?.aborted).toBe(
    true,
  )
  fail(new DriveError(503, 'Unavailable'))
  await Promise.resolve()
  expect(toast.error).not.toHaveBeenCalled()
})
