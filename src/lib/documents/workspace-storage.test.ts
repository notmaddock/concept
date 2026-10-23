import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyUpdate as applyYjsUpdate, Doc } from 'yjs'
import { localDocumentStorage } from './storages/local'
import type { DocumentInfo, DocumentPersistence } from './storage'
import { workspaceDocumentStorage } from './workspace-storage'
import {
  decodeUpdate,
  importConcept,
  parseConcept,
  serializeConcept,
} from './concept-file'
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
  for (const document of await localDocumentStorage.list())
    await localDocumentStorage.delete(document.id)
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  doc.getMap('metadata').set('test', true)
  await vi.advanceTimersByTimeAsync(1500)
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

it('finishes pending content saves after navigating away from the editor', async () => {
  await seed()
  save.mockImplementation(({ data }: { data: { text: string } }) =>
    Promise.resolve({ document: target, file: parseConcept(data.text) }),
  )
  const { doc, session } = await open(target.id)
  let state = ''
  session.subscribeStatus?.((status) => {
    state = status.state
  })
  await vi.waitFor(() => expect(state).toBe('pending'))
  doc.getMap('metadata').set('closed-editor', 'saved in background')
  await session.destroy()
  await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
  const uploaded = new Doc()
  docs.push(uploaded)
  applyYjsUpdate(
    uploaded,
    decodeUpdate(parseConcept(save.mock.calls[0][0].data.text)),
  )
  expect(uploaded.getMap('metadata').get('closed-editor')).toBe(
    'saved in background',
  )
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeUndefined(),
  )
})

it('resumes persisted content-only pending work from the library after reload', async () => {
  await seed()
  const { updateDocumentInfo } = await import('./storages/local')
  await updateDocumentInfo(target.id, (current) => ({
    ...current!,
    pendingSync: 'previous-page',
  }))
  save.mockImplementation(({ data }: { data: { text: string } }) =>
    Promise.resolve({ document: target, file: parseConcept(data.text) }),
  )
  await workspaceDocumentStorage.list()
  await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeUndefined(),
  )
})

it('retains closed offline edits and uploads them when reconnecting', async () => {
  await seed()
  save.mockRejectedValue(new Error('Offline'))
  const { doc, session } = await open(target.id)
  let state = ''
  session.subscribeStatus?.((status) => {
    state = status.state
  })
  await vi.waitFor(() => expect(state).toBe('pending'))
  doc.getMap('metadata').set('offline-closed', 'recover me')
  await session.destroy()
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 3000 })
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeTruthy(),
  )
  save.mockImplementation(({ data }: { data: { text: string } }) =>
    Promise.resolve({ document: target, file: parseConcept(data.text) }),
  )
  window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  const uploaded = new Doc()
  docs.push(uploaded)
  applyYjsUpdate(
    uploaded,
    decodeUpdate(parseConcept(save.mock.calls[1][0].data.text)),
  )
  expect(uploaded.getMap('metadata').get('offline-closed')).toBe('recover me')
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeUndefined(),
  )
})

it('includes persisted peer content before clearing its pending marker', async () => {
  await seed()
  const { doc, session } = await open(target.id)
  // A peer persistence instance writes directly to IndexedDB. No provider or
  // BroadcastChannel delivers this change to the workspace's in-memory Doc.
  const peer = new Doc()
  docs.push(peer)
  const peerSession = localDocumentStorage.open(target.id, peer)
  sessions.push(peerSession)
  await peerSession.whenSynced
  peer.getMap('metadata').set('peer-only', 'must reach Drive')
  const { updateDocumentInfo } = await import('./storages/local')
  await updateDocumentInfo(target.id, (current) => ({
    ...current!,
    pendingSync: 'peer-generation',
  }))
  expect(doc.getMap('metadata').get('peer-only')).toBeUndefined()
  save.mockImplementation(({ data }: { data: { text: string } }) =>
    Promise.resolve({ document: target, file: parseConcept(data.text) }),
  )
  session.retrySync?.()
  await vi.waitFor(() => expect(save).toHaveBeenCalled())
  const uploaded = new Doc()
  docs.push(uploaded)
  applyYjsUpdate(
    uploaded,
    decodeUpdate(parseConcept(save.mock.calls[0][0].data.text)),
  )
  expect(uploaded.getMap('metadata').get('peer-only')).toBe('must reach Drive')
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeUndefined(),
  )
})

it('preserves pending work when an upload finishes after a newer edit', async () => {
  await seed()
  let complete!: (result: {
    document: DocumentInfo
    file: ReturnType<typeof parseConcept>
  }) => void
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const { doc, session } = await open(target.id)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 3000 })
  const first = parseConcept(save.mock.calls[0][0].data.text)
  doc.getMap('metadata').set('later', 'new generation')
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.pendingSync,
    ).toBeTruthy(),
  )
  const newer = (await localDocumentStorage.get(target.id))?.pendingSync
  complete({ document: target, file: first })
  await vi.waitFor(async () =>
    expect((await localDocumentStorage.get(target.id))?.updatedAt).toBe(
      target.updatedAt,
    ),
  )
  await vi.waitFor(async () =>
    expect((await localDocumentStorage.get(target.id))?.pendingSync).toBe(
      newer,
    ),
  )
  save.mockImplementation(({ data }: { data: { text: string } }) =>
    Promise.resolve({ document: target, file: parseConcept(data.text) }),
  )
  await session.destroy()
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2), {
    timeout: 3000,
  })
  const uploaded = new Doc()
  docs.push(uploaded)
  applyYjsUpdate(
    uploaded,
    decodeUpdate(parseConcept(save.mock.calls[1][0].data.text)),
  )
  expect(uploaded.getMap('metadata').get('later')).toBe('new generation')
})

it('preserves a pending content marker when a Drive file is imported again', async () => {
  const file = await seed()
  const { updateDocumentInfo } = await import('./storages/local')
  await updateDocumentInfo(target.id, (current) => ({
    ...current!,
    pendingSync: 'unsaved-generation',
  }))
  await importConcept(file, target.name, target)
  expect((await localDocumentStorage.get(target.id))?.pendingSync).toBe(
    'unsaved-generation',
  )
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

it('preserves a local rename committed while an existing Drive file imports', async () => {
  const file = await seed()
  let rename: Promise<DocumentInfo> | undefined
  let started = false
  const stop = localDocumentStorage.subscribe((change) => {
    if (
      !started &&
      change.type === 'upsert' &&
      change.document.id === target.id
    ) {
      started = true
      rename = localDocumentStorage.rename(target.id, 'Concurrent rename')
    }
  })
  try {
    await importConcept(file, target.name, target)
    await rename
    expect((await localDocumentStorage.get(target.id))?.name).toBe(
      'Concurrent rename',
    )
  } finally {
    stop()
  }
})

it('atomically preserves a rename queued during upload-completion metadata access', async () => {
  const file = await seed()
  let resolve!: (result: { document: DocumentInfo; file: typeof file }) => void
  save.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const { session } = await open(target.id)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 2000 })
  let rename: Promise<DocumentInfo> | undefined
  const originalGet = IDBObjectStore.prototype.get
  const read = vi
    .spyOn(IDBObjectStore.prototype, 'get')
    .mockImplementation(function (this: IDBObjectStore, key) {
      const request = originalGet.call(this, key)
      if (this.name === 'documents' && key === target.id && !rename) {
        // Queue a real rename after this transaction has started. In the old
        // read-then-write sequence it committed before the stale replacement.
        rename = localDocumentStorage.rename(
          target.id,
          'Concurrent upload rename',
        )
      }
      return request
    })
  try {
    resolve({ document: target, file })
    await vi.waitFor(() => expect(rename).toBeDefined())
    await rename
    await vi.waitFor(async () =>
      expect((await localDocumentStorage.get(target.id))?.name).toBe(
        'Concurrent upload rename',
      ),
    )
  } finally {
    read.mockRestore()
    await session.destroy()
  }
})

it.each([false, true])(
  'syncs an inactive Drive rename with another editor open: %s',
  async (anotherEditor) => {
    const file = await seed()
    if (anotherEditor) {
      const local = await localDocumentStorage.create()
      await open(local.id)
    }
    const renamed = {
      ...target,
      name: 'Sidebar rename',
      backing: { ...target.backing!, syncedName: 'Sidebar rename' },
    }
    save.mockResolvedValue({ document: renamed, file })
    await workspaceDocumentStorage.rename(target.id, renamed.name)
    await vi.waitFor(
      () =>
        expect(save).toHaveBeenCalledWith({
          data: expect.objectContaining({ id: target.id, name: renamed.name }),
        }),
      { timeout: 2000 },
    )
    await vi.waitFor(async () =>
      expect(
        (await localDocumentStorage.get(target.id))?.backing?.syncedName,
      ).toBe(renamed.name),
    )
  },
)

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

it('resumes a persisted inactive rename when the library opens after a reload', async () => {
  const file = await seed()
  // Represents a rename persisted by a previous page before it went offline.
  await localDocumentStorage.rename(target.id, 'Rename before reload')
  const remote = {
    ...target,
    name: 'Rename before reload',
    backing: { ...target.backing!, syncedName: 'Rename before reload' },
  }
  save.mockResolvedValue({ document: remote, file })
  await workspaceDocumentStorage.list()
  await vi.waitFor(
    () =>
      expect(save).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: target.id, name: remote.name }),
      }),
    { timeout: 2000 },
  )
  await vi.waitFor(async () =>
    expect(
      (await localDocumentStorage.get(target.id))?.backing?.syncedName,
    ).toBe(remote.name),
  )
})

it('preserves a concurrent rename even if its upload finishes during import', async () => {
  const file = await seed()
  const persistence = await import('./storages/local')
  const originalPersist = persistence.persistDocumentUpdate
  const persist = vi
    .spyOn(persistence, 'persistDocumentUpdate')
    .mockImplementationOnce(async (id, update) => {
      await localDocumentStorage.rename(
        id,
        'Already uploaded concurrent rename',
      )
      await persistence.updateDocumentInfo(id, (current) => ({
        ...current!,
        backing: { ...current!.backing!, syncedName: current!.name },
      }))
      return originalPersist(id, update)
    })
  try {
    await importConcept(file, target.name, target)
    expect((await localDocumentStorage.get(target.id))?.name).toBe(
      'Already uploaded concurrent rename',
    )
  } finally {
    persist.mockRestore()
  }
})

it.each([false, true])(
  'settles peer saves without a loop when originating tab closes: %s',
  async (closeOrigin) => {
    const { TestBroadcastChannel, flushBroadcasts } =
      await import('#/test/broadcast-channel')
    const { LocalProvider } = await import('./local-provider')
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
    await seed()
    save.mockImplementation(({ data }: { data: { text: string } }) =>
      Promise.resolve({
        document: target,
        file: parseConcept(data.text),
      }),
    )
    const first = await open(target.id)
    const second = await open(target.id)
    let firstState = ''
    let secondState = ''
    first.session.subscribeStatus?.((next) => {
      firstState = next.state
    })
    second.session.subscribeStatus?.((next) => {
      secondState = next.state
    })
    const firstProvider = new LocalProvider(target.id, first.doc, first.session)
    const secondProvider = new LocalProvider(
      target.id,
      second.doc,
      second.session,
    )
    firstProvider.connect()
    secondProvider.connect()
    try {
      await flushBroadcasts()
      await vi.waitFor(
        () => {
          expect(firstState).toBe('synced')
          expect(secondState).toBe('synced')
        },
        { timeout: 2000 },
      )
      await flushBroadcasts()
      save.mockClear()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      first.doc.getMap('metadata').set('edit', 'from first tab')
      await flushBroadcasts()
      expect(second.doc.getMap('metadata').get('edit')).toBe('from first tab')
      expect(firstState).toBe('pending')
      expect(secondState).toBe('pending')
      if (closeOrigin) {
        firstProvider.destroy()
        await first.session.destroy()
      }
      await vi.advanceTimersByTimeAsync(1000)
      await vi.waitFor(() => expect(secondState).toBe('synced'))
      await flushBroadcasts()
      expect(save).toHaveBeenCalledTimes(closeOrigin ? 1 : 2)
      expect(secondState).toBe('synced')
      await vi.advanceTimersByTimeAsync(5000)
      await flushBroadcasts()
      expect(save).toHaveBeenCalledTimes(closeOrigin ? 1 : 2)
    } finally {
      firstProvider.destroy()
      secondProvider.destroy()
    }
  },
)

it('saves concurrent edits after 1 second instead of a 30-second error backoff', async () => {
  const file = await seed()
  let resolveFirst!: (result: {
    document: DocumentInfo
    file: typeof file
  }) => void
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
  )
  const { doc, session } = await open(target.id)
  let state = ''
  session.subscribeStatus?.((next) => {
    state = next.state
  })
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), {
    timeout: 2000,
  })
  expect(state).toBe('syncing')
  let updated = false
  const stop = localDocumentStorage.subscribe((change) => {
    if (change.type === 'upsert' && change.document.id === target.id)
      updated = true
  })
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // User edits while the first save is in flight
    doc.getMap('metadata').set('concurrent', 'edited during save')
    expect(state).toBe('pending')

    save.mockImplementationOnce(({ data }: { data: { text: string } }) =>
      Promise.resolve({
        document: target,
        file: parseConcept(data.text),
      }),
    )
    resolveFirst({ document: target, file })
    await vi.waitFor(() => expect(updated).toBe(true))

    // Should flush after 1 second (normal debounce), not 30 seconds
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(state).toBe('synced'))
  } finally {
    stop()
  }
})

it('handles synchronous synced status or early rejection during background sync without TDZ crash (LIFECYCLE-01)', async () => {
  await seed()
  const originalOpen = workspaceDocumentStorage.open
  const openSpy = vi
    .spyOn(workspaceDocumentStorage, 'open')
    .mockImplementation((id, doc) => {
      const real = originalOpen(id, doc)
      return {
        ...real,
        subscribeStatus(listener) {
          listener({ state: 'synced', message: 'Synced' })
          return () => {}
        },
      }
    })

  await localDocumentStorage.rename(target.id, 'Synchronous Background Sync')
  await expect(workspaceDocumentStorage.list()).resolves.toBeDefined()

  openSpy.mockRestore()
})

it('uploads cached unsynced content after reopening even when names match', async () => {
  const file = await seed()
  const first = await open(target.id)
  first.doc.getMap('metadata').set('offline-unsaved', 'kept')
  await first.session.destroy()
  save.mockResolvedValue({ document: target, file })
  const reopened = await open(target.id)
  expect(reopened.doc.getMap('metadata').get('offline-unsaved')).toBe('kept')
  await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
  const uploaded = new Doc()
  docs.push(uploaded)
  const snapshot = parseConcept(save.mock.calls[0][0].data.text)
  applyYjsUpdate(uploaded, decodeUpdate(snapshot))
  expect(uploaded.getMap('metadata').get('offline-unsaved')).toBe('kept')
  expect(save.mock.calls[0][0].data).toMatchObject({
    name: target.name,
    previousName: target.name,
  })
})
