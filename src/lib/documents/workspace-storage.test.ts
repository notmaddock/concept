import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Doc } from 'yjs'
import { localDocumentStorage } from './storage'
import type { DocumentInfo, DocumentPersistence } from './storage'
import { workspaceDocumentStorage } from './workspace-storage'
import { importConcept, parseConcept, serializeConcept } from './concept-file'
import { initializeDocument } from './initial-document'

const save = vi.hoisted(() => vi.fn())
vi.mock('./drive/functions', () => ({ saveDrive: save }))
let docs: Array<Doc>
let sessions: Array<DocumentPersistence>
const target: DocumentInfo = {
  id: '0aad2d15-507a-43ca-8a04-e194484002a3',
  name: 'Drive document',
  updatedAt: 1,
  backing: {
    provider: 'google-drive',
    fileId: 'backing-file',
    accountId: 'account',
    syncedName: 'Drive document',
  },
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  save.mockReset()
  docs = []
  sessions = []
})
afterEach(async () => {
  await Promise.all(sessions.map((session) => session.destroy()))
  docs.forEach((doc) => doc.destroy())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function seed() {
  const doc = new Doc()
  docs.push(doc)
  initializeDocument(doc)
  const file = parseConcept(serializeConcept(target.name, doc))
  await importConcept(file, target.name, target)
  return file
}
async function open(id: string) {
  const doc = new Doc()
  docs.push(doc)
  const session = workspaceDocumentStorage.open(id, doc)
  sessions.push(session)
  await session.whenSynced
  return { doc, session }
}
it('never requests remote credentials for local documents', async () => {
  const document = await localDocumentStorage.create()
  const { doc } = await open(document.id)
  doc.getMap('metadata').set('test', true)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(save).not.toHaveBeenCalled()
})

it('keeps a stable Concept ID and merges cached content when reopening from Drive', async () => {
  const file = await seed()
  const { doc } = await open(target.id)
  doc.getMap('metadata').set('offline', 'preserved')
  await importConcept(file, target.name, target)
  expect(await localDocumentStorage.list()).toHaveLength(1)
  const reopened = await open(target.id)
  expect(reopened.doc.getMap('metadata').get('offline')).toBe('preserved')
  await expect(
    importConcept(file, target.name, {
      ...target,
      backing: { ...target.backing!, fileId: 'different-file' },
    }),
  ).rejects.toThrow('different document')
})

it('opens cached documents while signed out, reports failed uploads, and retries on reconnect', async () => {
  const file = await seed()
  save.mockRejectedValue(new Error('Sign in to use a storage connection.'))
  const { doc, session } = await open(target.id)
  let status = ''
  session.subscribeStatus?.((next) => {
    status = next.message
  })
  // Let the cache metadata read attach the remote session before advancing timers.
  await vi.waitFor(() => expect(status).toContain('waiting'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  doc.getMap('metadata').set('offline', 'safe')
  await vi.advanceTimersByTimeAsync(1000)
  await vi.waitFor(() => expect(status).toContain('Sign in'))
  expect(doc.getMap('metadata').get('offline')).toBe('safe')
  save.mockResolvedValue({ document: target, file })
  window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(status).toContain('Saved to Google Drive'))
  expect(save).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      id: target.id,
      fileId: 'backing-file',
      accountId: 'account',
    }),
  })
})

it('stops scheduled uploads when a document is closed', async () => {
  await seed()
  const { session } = await open(target.id)
  await session.destroy()
  expect(save).not.toHaveBeenCalled()
})

it('refreshes already-mounted documents when the same Drive file is explicitly reopened', async () => {
  await seed()
  const { doc } = await open(target.id)
  const remote = new Doc()
  docs.push(remote)
  const source = parseConcept(serializeConcept(target.name, doc))
  const { applyUpdate } = await import('yjs')
  applyUpdate(
    remote,
    Uint8Array.from(atob(source.update), (c) => c.charCodeAt(0)),
  )
  remote.getMap('metadata').set('remote', 'downloaded change')
  await importConcept(
    parseConcept(serializeConcept(target.name, remote)),
    target.name,
    target,
  )
  expect(doc.getMap('metadata').get('remote')).toBe('downloaded change')
})

it('does not recreate content or metadata when deletion wins a concurrent import', async () => {
  const file = await seed()
  let deletion: Promise<void> | undefined
  let started = false
  const stop = localDocumentStorage.subscribe((change) => {
    if (
      !started &&
      change.type === 'upsert' &&
      change.document.id === target.id
    ) {
      started = true
      deletion = localDocumentStorage.delete(target.id)
    }
  })
  try {
    await expect(importConcept(file, target.name, target)).rejects.toThrow(
      'Document not found',
    )
    await deletion
    expect(await localDocumentStorage.get(target.id)).toBeUndefined()
    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain(
      `concept-document:${target.id}`,
    )
  } finally {
    stop()
  }
})

it('broadcasts imported changes to a document provider in another tab', async () => {
  const { TestBroadcastChannel, flushBroadcasts } =
    await import('#/test/broadcast-channel')
  const { LocalProvider } = await import('./local-provider')
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  await seed()
  const peer = new Doc()
  docs.push(peer)
  const provider = new LocalProvider(target.id, peer, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  provider.connect()
  await flushBroadcasts()
  const remote = new Doc()
  docs.push(remote)
  initializeDocument(remote)
  remote.getMap('metadata').set('remote', 'other tab receives import')
  try {
    await importConcept(
      parseConcept(serializeConcept(target.name, remote)),
      target.name,
      target,
    )
    await flushBroadcasts()
    expect(peer.getMap('metadata').get('remote')).toBe(
      'other tab receives import',
    )
  } finally {
    provider.destroy()
  }
})
