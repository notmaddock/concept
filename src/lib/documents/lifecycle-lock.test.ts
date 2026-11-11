import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import { Doc } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel } from '#/test/broadcast-channel'
import { openAssetRepository } from './assets'
import type { AssetRepository } from './assets'
import { localDocumentStorage } from './storage'
import type { DocumentPersistence } from './storage'
import { documentAssets } from './working'

let repositories: AssetRepository[]
let doc: Doc
let session: DocumentPersistence | undefined

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  vi.stubGlobal('navigator', {})
  repositories = []
  doc = new Doc()
  session = undefined
})

afterEach(async () => {
  await session?.destroy()
  repositories.forEach((repository) => repository.close())
  doc.destroy()
  // publishDocumentChange closes its temporary channel on a macrotask.
  await vi.waitFor(() => expect(TestBroadcastChannel.channels.size).toBe(0))
  vi.unstubAllGlobals()
})

it('serializes document deletion after an asset ownership check without Web Locks', async () => {
  const document = await localDocumentStorage.create()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const order: string[] = []
  const repository = openAssetRepository(document.id, {
    async assertWritable() {
      expect(await localDocumentStorage.get(document.id)).toBeDefined()
      order.push('ownership checked')
      await gate
    },
  })
  repositories.push(repository)
  const writing = repository.put(new Blob(['pending bytes'])).then(() => {
    order.push('asset committed')
  })
  await vi.waitFor(() => expect(order).toEqual(['ownership checked']))
  let deleted = false
  const deleting = localDocumentStorage.delete(document.id).then(() => {
    deleted = true
    order.push('document deleted')
  })
  // Let IndexedDB deletion advance if the two stores accidentally use different queues.
  await new Promise<void>((resolve) => setTimeout(resolve, 25))
  expect(deleted).toBe(false)
  expect(await localDocumentStorage.get(document.id)).toBeDefined()
  release()
  await writing
  await deleting
  expect(order).toEqual([
    'ownership checked',
    'asset committed',
    'document deleted',
  ])
  expect(await localDocumentStorage.get(document.id)).toBeUndefined()
  const inspection = openAssetRepository(document.id)
  repositories.push(inspection)
  expect(await inspection.list()).toEqual([])
})

it('cannot recreate deleted asset ownership when hashing finishes after a document closes', async () => {
  const document = await localDocumentStorage.create()
  session = localDocumentStorage.open(document.id, doc)
  await session.whenSynced
  const repository = documentAssets(doc)!
  const blob = new Blob(['slow hashing input'])
  const bytes = await blob.arrayBuffer()
  let release: (value: ArrayBuffer) => void = () => {}
  const gate = new Promise<ArrayBuffer>((resolve) => {
    release = resolve
  })
  const reading = vi.spyOn(blob, 'arrayBuffer').mockReturnValue(gate)
  const writing = repository.put(blob)
  const rejection = expect(writing).rejects.toThrow('closed')
  await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce())
  await localDocumentStorage.delete(document.id)
  release(bytes)
  await rejection
  const inspection = openAssetRepository(document.id)
  repositories.push(inspection)
  expect(await inspection.list()).toEqual([])
  expect(await localDocumentStorage.get(document.id)).toBeUndefined()
})
