import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import {
  AssetIntegrityError,
  AssetLimitError,
  assetId,
  copyDocumentAssets,
  deleteDocumentAssets,
  describeAsset,
  isAssetId,
  openAssetRepository,
} from './assets'
import type { AssetRepository } from './assets'

let repositories: Array<AssetRepository>

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  repositories = []
})

afterEach(() => {
  repositories.forEach((repository) => repository.close())
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.unstubAllGlobals()
})

function open(id: string, options?: Parameters<typeof openAssetRepository>[1]) {
  const repository = openAssetRepository(id, options)
  repositories.push(repository)
  return repository
}

it('addresses exact bytes and normalizes MIME without trusting declared executable types', async () => {
  const blob = new Blob(['hello'], { type: 'text/html' })
  const descriptor = await describeAsset(blob)
  expect(descriptor).toEqual({
    id: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    byteLength: 5,
    mediaType: 'application/octet-stream',
  })
  expect(isAssetId(descriptor.id)).toBe(true)
  expect(isAssetId(descriptor.id.toUpperCase())).toBe(false)
  expect(isAssetId('sha256:123')).toBe(false)
  expect(await assetId(new TextEncoder().encode('hello'))).toBe(descriptor.id)
  expect(
    await describeAsset(
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]),
    ),
  ).toMatchObject({ mediaType: 'image/png' })
})

it('commits durable immutable binary records before availability and deduplicates concurrent puts', async () => {
  const repository = open('one')
  const peer = open('one')
  const listener = vi.fn()
  peer.subscribe(listener)
  const blob = new Blob(['same'], { type: 'image/png' })
  const [first, second] = await Promise.all([
    repository.put(blob),
    peer.put(new Blob(['same'], { type: 'text/plain' })),
  ])
  expect(first).toEqual(second)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledWith(first.id)
  expect(await repository.list()).toEqual([first])
  await repository.flush()
  repository.close()
  const reopened = open('one')
  expect(await (await reopened.get(first.id))?.text()).toBe('same')
  expect(await open('two').get(first.id)).toBeUndefined()
})

it('stages and verifies an entire import before making any asset visible', async () => {
  const repository = open('import')
  const good = new Blob(['good'])
  const descriptor = await describeAsset(good)
  const listener = vi.fn()
  repository.subscribe(listener)
  await expect(
    repository.importAssets([
      { descriptor, blob: good },
      { descriptor, blob: new Blob(['wrong']) },
    ]),
  ).rejects.toBeInstanceOf(AssetIntegrityError)
  expect(await repository.list()).toEqual([])
  expect(listener).not.toHaveBeenCalled()
  await repository.importAssets([
    { descriptor: { ...descriptor, mediaType: 'text/html' }, blob: good },
    { descriptor, blob: good },
  ])
  expect(await repository.list()).toEqual([descriptor])
  expect(listener).toHaveBeenCalledTimes(1)
})

it('rejects oversized and cancelled writes without announcing or retaining bytes', async () => {
  const repository = open('limits', { maxAssetBytes: 2 })
  const listener = vi.fn()
  repository.subscribe(listener)
  await expect(repository.put(new Blob(['large']))).rejects.toBeInstanceOf(
    AssetLimitError,
  )
  const cancellation = new AbortController()
  cancellation.abort()
  await expect(
    repository.put(new Blob(['ok']), cancellation.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(await repository.list()).toEqual([])
  expect(listener).not.toHaveBeenCalled()
})

it('checks document ownership under its commit lock and cancels late closed-session writes', async () => {
  const guard = vi.fn(() => {
    throw new Error('Document deleted')
  })
  const repository = open('deleted', { assertWritable: guard })
  await expect(repository.put(new Blob(['data']))).rejects.toThrow(
    'Document deleted',
  )
  expect(await repository.list()).toEqual([])
  expect(guard).toHaveBeenCalledTimes(1)
  const closing = open('closing')
  const pending = closing.put(new Blob(['data']))
  closing.close()
  await expect(pending).rejects.toThrow('Asset repository closed')
  expect(await open('closing').list()).toEqual([])
})

it('isolates copies and deletes ownership only after closing existing repositories', async () => {
  const source = open('source')
  const descriptor = await source.put(new Blob(['retained for undo']))
  const pin = source.pin([descriptor.id])
  await copyDocumentAssets('source', 'copy')
  pin.release()
  pin.release()
  const target = open('copy')
  expect(await target.list()).toEqual([descriptor])
  await deleteDocumentAssets('source')
  await expect(source.get(descriptor.id)).rejects.toThrow('closed')
  expect(await open('source').list()).toEqual([])
  expect(await (await target.get(descriptor.id))?.text()).toBe(
    'retained for undo',
  )
})

it('validates cross-tab announcements and releases subscriptions on close', async () => {
  const repository = open('one')
  const listener = vi.fn()
  repository.subscribe(listener)
  const remote = new TestBroadcastChannel('concept-assets')
  const id = await assetId(new Uint8Array([1]))
  remote.postMessage({ documentId: 'two', id })
  remote.postMessage({ documentId: 'one', id: '../bad' })
  remote.postMessage({ documentId: 'one', id })
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledExactlyOnceWith(id)
  repository.close()
  remote.postMessage({ documentId: 'one', id })
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledTimes(1)
  remote.close()
})
