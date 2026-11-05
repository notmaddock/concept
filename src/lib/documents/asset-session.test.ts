import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import { Doc } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel } from '#/test/broadcast-channel'
import { attachDocumentAssets } from './working'
import { describeAsset, openAssetRepository } from './assets'
import type { AssetRepository } from './assets'
import {
  createAssetObjectUrl,
  createDocumentAssetResolver,
  insertDocumentAsset,
} from './asset-session'
import type { DocumentAssetResolver } from './asset-session'

let doc: Doc
let repository: AssetRepository
let resolver: DocumentAssetResolver | undefined

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  doc = new Doc()
  repository = openAssetRepository('document')
  attachDocumentAssets(doc, repository)
})

afterEach(() => {
  resolver?.close()
  resolver = undefined
  repository.close()
  doc.destroy()
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.unstubAllGlobals()
})

function insertionOptions() {
  return {
    doc,
    blob: new Blob(['asset bytes']),
    canEdit: () => true,
    insert: vi.fn(),
    flush: vi.fn(async () => {}),
    requestSave: vi.fn(),
  }
}

it('persists bytes before the content transaction, then flushes and requests urgent publication', async () => {
  const options = insertionOptions()
  let committed = false
  const stop = repository.subscribe(() => {
    committed = true
  })
  options.insert.mockImplementation((descriptor) => {
    expect(committed).toBe(true)
    doc.getMap('references').set('asset', descriptor.id)
  })
  const descriptor = await insertDocumentAsset(options)
  expect(await (await repository.get(descriptor.id))?.text()).toBe(
    'asset bytes',
  )
  expect(doc.getMap('references').get('asset')).toBe(descriptor.id)
  expect(options.flush).toHaveBeenCalledOnce()
  expect(options.requestSave).toHaveBeenCalledOnce()
  expect(options.insert.mock.invocationCallOrder[0]).toBeLessThan(
    options.flush.mock.invocationCallOrder[0],
  )
  expect(options.flush.mock.invocationCallOrder[0]).toBeLessThan(
    options.requestSave.mock.invocationCallOrder[0],
  )
  stop()
})

it('does not insert a dangling local reference when persistence fails', async () => {
  repository.close()
  const options = insertionOptions()
  await expect(insertDocumentAsset(options)).rejects.toThrow('closed')
  expect(options.insert).not.toHaveBeenCalled()
  expect(options.requestSave).not.toHaveBeenCalled()
})

it('rechecks cancellation, permission and editor lifetime after the durable put', async () => {
  for (const reason of ['cancel', 'permission', 'closed'] as const) {
    const controller = new AbortController()
    let canEdit = true
    let alive = true
    const stop = repository.subscribe(() => {
      if (reason === 'cancel') controller.abort()
      if (reason === 'permission') canEdit = false
      if (reason === 'closed') alive = false
    })
    const options = {
      ...insertionOptions(),
      blob: new Blob([reason]),
      signal: controller.signal,
      canEdit: () => canEdit,
      isAlive: () => alive,
    }
    await expect(insertDocumentAsset(options)).rejects.toThrow()
    expect(options.insert).not.toHaveBeenCalled()
    expect(options.requestSave).not.toHaveBeenCalled()
    stop()
  }
  expect(await repository.list()).toHaveLength(3)
})

it('rejects an already destroyed editor before writing bytes', async () => {
  doc.destroy()
  const options = insertionOptions()
  await expect(insertDocumentAsset(options)).rejects.toMatchObject({
    code: 'closed',
  })
  expect(await repository.list()).toEqual([])
})

it('resolves several missing hashes through one document reconciliation without content edits', async () => {
  const one = new Blob(['one'])
  const two = new Blob(['two'])
  const first = await describeAsset(one)
  const second = await describeAsset(two)
  let release: () => void = () => {}
  const uploaded = new Promise<void>((resolve) => {
    release = resolve
  })
  const recover = vi.fn(async () => {
    await uploaded
    await repository.importAssets([
      { descriptor: first, blob: one },
      { descriptor: second, blob: two },
    ])
  })
  const onUpdate = vi.fn()
  doc.on('update', onUpdate)
  resolver = createDocumentAssetResolver({ repository, recover })
  const pending = Promise.all([
    resolver.resolve(first.id),
    resolver.resolve(second.id),
  ])
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
  release()
  expect(await pending).toMatchObject([
    { state: 'available' },
    { state: 'available' },
  ])
  expect(recover).toHaveBeenCalledOnce()
  expect(onUpdate).not.toHaveBeenCalled()
})

it('retries a missing hash and observes a late local arrival independently of Yjs', async () => {
  const blob = new Blob(['late'])
  const descriptor = await describeAsset(blob)
  const recover = vi.fn(async () => {})
  resolver = createDocumentAssetResolver({ repository, recover })
  expect(await resolver.resolve(descriptor.id)).toEqual({
    state: 'unavailable',
    cause: { kind: 'missing' },
  })
  await resolver.retry()
  expect(recover).toHaveBeenCalledTimes(2)
  const listener = vi.fn()
  const stop = resolver.subscribe(descriptor.id, listener)
  await repository.put(blob)
  await vi.waitFor(() =>
    expect(resolver!.getState(descriptor.id)).toMatchObject({
      state: 'available',
    }),
  )
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'available' }),
  )
  stop()
})

it('retains typed retrieval causes and cancels late completions when the resolver closes', async () => {
  const descriptor = await describeAsset(new Blob(['missing']))
  const failure = new Error('No permission')
  resolver = createDocumentAssetResolver({
    repository,
    recover: async () => {
      throw failure
    },
    classifyFailure: (error) => ({ kind: 'permission', error }),
  })
  expect(await resolver.resolve(descriptor.id)).toEqual({
    state: 'unavailable',
    cause: { kind: 'permission', error: failure },
  })
  resolver.close()
  const listener = vi.fn()
  resolver.subscribe(descriptor.id, listener)
  await repository.put(new Blob(['missing']))
  expect(listener).not.toHaveBeenCalled()
  expect(await resolver.resolve(descriptor.id)).toMatchObject({
    state: 'unavailable',
    cause: { kind: 'cancelled' },
  })
})

it('revokes view-only object URLs exactly once', () => {
  const create = vi.fn(() => 'blob:view-resource')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const resource = createAssetObjectUrl(new Blob(['view']))
  expect(resource.url).toBe('blob:view-resource')
  resource.dispose()
  resource.dispose()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:view-resource')
})

it('coalesces concurrent missing requests even when a remote check completes immediately', async () => {
  const first = await describeAsset(new Blob(['one']))
  const second = await describeAsset(new Blob(['two']))
  const recover = vi.fn(async () => {})
  resolver = createDocumentAssetResolver({ repository, recover })
  await Promise.all([resolver.resolve(first.id), resolver.resolve(second.id)])
  expect(recover).toHaveBeenCalledOnce()
})
