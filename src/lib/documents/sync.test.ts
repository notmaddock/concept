import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { serializeConcept } from './serialization'
import {
  DocumentSync,
  documentSessions,
  getSaveStatus,
  mergeConcept,
} from './sync'
import {
  DriveError,
  getFileMetadata,
  readConceptFile,
  updateConceptFile,
} from './drive/api'
import type { DocumentInfo } from './storage'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('./drive/api', () => ({
  DriveError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  },
  readConceptFile: vi.fn(),
  getFileMetadata: vi.fn(),
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
    },
  }
}

async function start() {
  session = new DocumentSync(info, local, {
    whenSynced: Promise.resolve(),
    flush,
    destroy: async () => {},
  })
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
  vi.useFakeTimers()
  vi.clearAllMocks()
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
  read.mockImplementation(async () => ({
    ...version('"base"'),
    content: serializeConcept('Test', remote),
  }))
  metadata.mockResolvedValue(version('"base"'))
  write.mockResolvedValue(version('"saved"'))
})

afterEach(async () => {
  await session.stop()
  local.destroy()
  remote.destroy()
  vi.useRealTimers()
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
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][3]).toBe('"base"')
  await session.sync()
  expect(getSaveStatus(info.id).phase).toBe('synced')
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
  expect(write).toHaveBeenCalledOnce()
})

it('checks only metadata when focus returns to an unchanged clean document', async () => {
  await start()
  read.mockClear()
  window.dispatchEvent(new Event('focus'))
  await session.sync(true)
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
  mergeConcept(saved, write.mock.calls[0][2])
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
    content: serializeConcept('Test', remote),
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
  mergeConcept(saved, write.mock.calls[0][2])
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
    content: serializeConcept('Test', remote),
  })
  remote.getMap('settings').set('another', 'second')
  read.mockResolvedValueOnce({
    ...version('"remote-2"'),
    content: serializeConcept('Test', remote),
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
  mergeConcept(saved, write.mock.calls[2][2])
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
  await vi.advanceTimersByTimeAsync(3000)
  expect(write).toHaveBeenCalledTimes(2)
  expect(write.mock.calls[1][3]).toBe('"first-save"')
  const saved = new Doc()
  mergeConcept(saved, write.mock.calls[1][2])
  expect(saved.getMap('settings').get('during-upload')).toBe(true)
  saved.destroy()
})

it('uploads deletion-only changes even when the Yjs state vector is unchanged', async () => {
  await start()
  const before = encodeStateVector(local)
  local.getText('root').delete(0, 4)
  expect(encodeStateVector(local)).toEqual(before)
  await vi.advanceTimersByTimeAsync(3000)
  expect(write).toHaveBeenCalledOnce()
  const saved = new Doc()
  mergeConcept(saved, write.mock.calls[0][2])
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
  expect(write).toHaveBeenCalledOnce()
})

it('adopts an external Drive filename even when the embedded name is older', async () => {
  await start()
  const renamed = version('"renamed"')
  renamed.file.name = 'External name.concept'
  metadata.mockResolvedValueOnce(renamed)
  read.mockResolvedValueOnce({
    ...renamed,
    content: serializeConcept('Test', remote),
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
