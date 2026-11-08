import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import { unzipSync, zipSync } from 'fflate'
import { Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel } from '#/test/broadcast-channel'
import type { AssetId } from './assets'
import { describeAsset, openAssetRepository } from './assets'
import { importConcept } from './concept-file'
import { readPackage, writePackage, snapshotRevision } from './package'
import type { NormalizedSnapshot, PackageAsset } from './package'
import { localDocumentStorage } from './storage'
import type { DocumentPersistence } from './storage'
import { documentSaveProviders, documentSources } from './transfer'
import {
  captureSnapshot,
  captureRevisionSnapshot,
  documentAssets,
  IncompleteAssetsError,
} from './working'

let documents: Doc[]
let sessions: DocumentPersistence[]

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Offline'))),
  )
  documents = []
  sessions = []
})

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.destroy()))
  documents.forEach((doc) => doc.destroy())
  // Allow deferred broadcast channel cleanup macrotasks to drain.
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await promise
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function sourceSnapshot(): Promise<NormalizedSnapshot> {
  const doc = new Doc()
  documents.push(doc)
  doc.get('root', XmlText).insert(0, 'Offline résumé 🌎')
  doc.getMap('settings').set('pageSetup', { mode: 'paper', width: 210 })
  const assets: PackageAsset[] = []
  for (const blob of [
    new Blob(['%PDF-1.7\nattachment']),
    new Blob([new Uint8Array([0, 255, 128, 4, 0, 13])]),
  ]) {
    const descriptor = await describeAsset(blob)
    assets.push({ descriptor, blob })
    const node = new XmlText()
    node.setAttribute('__type', 'image')
    node.setAttribute('__imageVersion', 1)
    node.setAttribute('__source', {
      assetId: descriptor.id,
      intrinsicWidth: 100,
      intrinsicHeight: 100,
    })
    doc.get('root', XmlText).insertEmbed(0, node)
  }
  return {
    name: 'Résumé',
    update: encodeStateAsUpdate(doc),
    assets,
    requiredFeatures: [],
  }
}

async function reopen(id: string) {
  const doc = new Doc()
  documents.push(doc)
  const session = localDocumentStorage.open(id, doc)
  sessions.push(session)
  await session.whenSynced
  return { doc, session, repository: documentAssets(doc)! }
}

async function readComplete(bytes: Uint8Array) {
  const result = await readPackage(bytes)
  expect(result.kind).toBe('complete')
  if (result.kind !== 'complete') throw new Error('Expected complete package')
  return result.snapshot
}

it('imports multiple asset kinds, reloads, exports, and reimports into a clean offline database', async () => {
  const original = await sourceSnapshot()
  const incoming = await readComplete(await writePackage(original))
  const imported = await importConcept(incoming)
  const loaded = await reopen(imported.id)
  expect(loaded.doc.get('root', XmlText).toString()).toBe('Offline résumé 🌎')
  expect(loaded.doc.getMap('settings').get('pageSetup')).toEqual({
    mode: 'paper',
    width: 210,
  })
  for (const asset of original.assets) {
    expect(
      new Uint8Array(
        await (await loaded.repository.get(asset.descriptor.id))!.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array(await asset.blob.arrayBuffer()))
  }
  const exported = await writePackage(
    await captureSnapshot(imported.name, loaded.doc),
  )
  await loaded.session.destroy()
  vi.stubGlobal('indexedDB', new IDBFactory())
  const clean = await importConcept(await readComplete(exported))
  expect(clean.id).not.toBe(imported.id)
  const offline = await reopen(clean.id)
  expect(offline.doc.get('root', XmlText).toString()).toBe('Offline résumé 🌎')
  expect(
    (await offline.repository.list()).map((asset) => asset.id).sort(),
  ).toEqual(original.assets.map((asset) => asset.descriptor.id).sort())
  expect((await captureSnapshot(clean.name, offline.doc)).assets).toHaveLength(
    2,
  )
  expect(fetch).not.toHaveBeenCalled()
})

it('copies the entire retained inventory through local source and save-provider contracts', async () => {
  const original = await sourceSnapshot()
  const imported = await importConcept(original)
  const local = documentSources.find((source) => source.kind === 'library')!
  const selected = await local.read(imported)
  const copy = await documentSaveProviders[0].save(
    selected.file,
    'Independent copy',
  )
  expect(copy.id).not.toBe(imported.id)
  expect(copy.name).toBe('Independent copy')
  const loaded = await reopen(copy.id)
  expect(
    (await captureSnapshot(copy.name, loaded.doc)).assets
      .map((asset) => asset.descriptor.id)
      .sort(),
  ).toEqual(original.assets.map((asset) => asset.descriptor.id).sort())
  await localDocumentStorage.delete(imported.id)
  for (const asset of original.assets)
    expect(await loaded.repository.get(asset.descriptor.id)).toBeDefined()
  const removed = openAssetRepository(imported.id)
  try {
    expect(await removed.list()).toEqual([])
  } finally {
    removed.close()
  }
})

it('closes active sessions and deletes only the removed document owned assets', async () => {
  const snapshot = await sourceSnapshot()
  const removed = await importConcept(snapshot)
  const retained = await importConcept(snapshot)
  const open = await reopen(removed.id)
  await localDocumentStorage.delete(removed.id)
  expect(documentAssets(open.doc)).toBeUndefined()
  await expect(
    open.repository.get(snapshot.assets[0].descriptor.id),
  ).rejects.toThrow('closed')
  expect(await localDocumentStorage.get(removed.id)).toBeUndefined()
  const inspection = openAssetRepository(removed.id)
  try {
    expect(await inspection.list()).toEqual([])
  } finally {
    inspection.close()
  }
  const other = await reopen(retained.id)
  expect(await other.repository.list()).toHaveLength(2)
})

it('persists recovery incompleteness across reloads until verified missing bytes are repaired', async () => {
  const original = await sourceSnapshot()
  const entries = unzipSync(await writePackage(original))
  const absent = original.assets[0]
  delete entries[`assets/${absent.descriptor.id.slice(7)}`]
  const recovery = await readPackage(zipSync(entries, { level: 0 }))
  expect(recovery.kind).toBe('incomplete')
  if (recovery.kind !== 'incomplete')
    throw new Error('Expected recovery package')
  const imported = await importConcept(
    recovery.snapshot,
    'Recovered copy',
    recovery.missingAssets,
  )
  const first = await reopen(imported.id)
  await expect(
    captureSnapshot(imported.name, first.doc),
  ).rejects.toBeInstanceOf(IncompleteAssetsError)
  await first.session.destroy()
  const second = await reopen(imported.id)
  await expect(
    captureSnapshot(imported.name, second.doc),
  ).rejects.toMatchObject({ missingAssets: [absent.descriptor.id] })
  expect(second.doc.get('root', XmlText).toString()).toBe('Offline résumé 🌎')
  expect(await second.repository.list()).toHaveLength(1)
  await second.repository.put(absent.blob)
  await second.session.flush?.()
  const repaired = await readComplete(
    await writePackage(await captureSnapshot(imported.name, second.doc)),
  )
  expect(repaired.assets).toHaveLength(2)
  await second.session.destroy()
  const third = await reopen(imported.id)
  expect((await captureSnapshot(imported.name, third.doc)).assets).toHaveLength(
    2,
  )
})

it('never lists or announces a failed staged import and leaves an existing document intact', async () => {
  const snapshot = await sourceSnapshot()
  const existing = await importConcept(snapshot)
  const events = vi.fn()
  const stop = localDocumentStorage.subscribe(events)
  const firstBytes = await snapshot.assets[0].blob.arrayBuffer()
  let release: (bytes: ArrayBuffer) => void = () => {}
  const gate = new Promise<ArrayBuffer>((resolve) => {
    release = resolve
  })
  const read = vi
    .spyOn(snapshot.assets[0].blob, 'arrayBuffer')
    .mockReturnValue(gate)
  const corrupt: NormalizedSnapshot = {
    ...snapshot,
    assets: [
      snapshot.assets[0],
      { ...snapshot.assets[1], blob: new Blob(['corrupt']) },
    ],
  }
  try {
    const importing = importConcept(corrupt)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    expect((await localDocumentStorage.list()).map((item) => item.id)).toEqual([
      existing.id,
    ])
    expect(
      events.mock.calls.filter(([event]) => event.type === 'upsert'),
    ).toEqual([])
    release(firstBytes)
    await expect(importing).rejects.toThrow('do not match')
    expect((await localDocumentStorage.list()).map((item) => item.id)).toEqual([
      existing.id,
    ])
    expect(
      events.mock.calls.filter(([event]) => event.type === 'upsert'),
    ).toEqual([])
    const loaded = await reopen(existing.id)
    expect(await loaded.repository.list()).toHaveLength(2)
    expect(loaded.doc.get('root', XmlText).toString()).toBe('Offline résumé 🌎')
  } finally {
    stop()
  }
})

it('computes dirty revisions from trusted descriptors without reading asset bytes', async () => {
  const info = await importConcept(await sourceSnapshot())
  const loaded = await reopen(info.id)
  const get = vi
    .spyOn(loaded.repository, 'get')
    .mockRejectedValue(new Error('Blob bytes must not be read for a revision'))
  const revision = await snapshotRevision(
    await captureRevisionSnapshot(info.name, loaded.doc),
  )
  expect(revision).toMatch(/^[a-f0-9]{64}$/)
  expect(get).not.toHaveBeenCalled()
  loaded.doc.get('root', XmlText).insert(0, 'Changed ')
  expect(
    await snapshotRevision(
      await captureRevisionSnapshot(info.name, loaded.doc),
    ),
  ).not.toBe(revision)
  expect(get).not.toHaveBeenCalled()
})

it('ignores orphan repository assets without blobs and does not throw IncompleteAssetsError', async () => {
  const original = await sourceSnapshot()
  const imported = await importConcept(original)
  const loaded = await reopen(imported.id)

  const orphanId =
    'sha256:0000000000000000000000000000000000000000000000000000000000000000' as AssetId
  const realList = loaded.repository.list.bind(loaded.repository)
  const realGet = loaded.repository.get.bind(loaded.repository)

  vi.spyOn(loaded.repository, 'list').mockImplementation(async () => {
    const list = await realList()
    return [
      ...list,
      {
        id: orphanId,
        mediaType: 'application/octet-stream',
        byteLength: 42,
      },
    ]
  })
  vi.spyOn(loaded.repository, 'get').mockImplementation(async (id) => {
    if (id === orphanId) return undefined
    return realGet(id)
  })

  const snapshot = await captureSnapshot(imported.name, loaded.doc)
  expect(snapshot.assets).toHaveLength(2)
})

it('gracefully handles IncompleteAssetsError in library source read for document recovery', async () => {
  const original = await sourceSnapshot()
  const entries = unzipSync(await writePackage(original))
  const absent = original.assets[0]
  delete entries[`assets/${absent.descriptor.id.slice(7)}`]
  const recovery = await readPackage(zipSync(entries, { level: 0 }))
  if (recovery.kind !== 'incomplete')
    throw new Error('Expected incomplete package')

  const imported = await importConcept(
    recovery.snapshot,
    'Damaged import',
    recovery.missingAssets,
  )

  const librarySource = documentSources.find(
    (source) => source.kind === 'library',
  )!
  const selected = await librarySource.read(imported)

  expect(selected.existingId).toBe(imported.id)
  expect(selected.filename).toBe('Damaged import')
  expect(selected.missingAssets).toEqual([absent.descriptor.id])
  expect(selected.file.assets).toHaveLength(1)
  expect(selected.file.name).toBe('Damaged import')
  expect(selected.size).toBeGreaterThan(0)

  const copy = await documentSaveProviders[0].save(
    selected.file,
    'Recovered document copy',
    selected.missingAssets,
  )
  const reopenedCopy = await reopen(copy.id)
  await expect(
    captureSnapshot(copy.name, reopenedCopy.doc),
  ).rejects.toMatchObject({ missingAssets: [absent.descriptor.id] })
})
