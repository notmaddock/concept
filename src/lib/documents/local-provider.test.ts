import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Doc, XmlText, encodeStateAsUpdate } from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import { LocalProvider } from './local-provider'
import { initializeDocument } from './initial-document'
import { localDocumentStorage } from './storage'

let providers: Array<LocalProvider>
let docs: Array<Doc>

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  vi.stubGlobal('indexedDB', new IDBFactory())
  TestBroadcastChannel.sent = 0
  providers = []
  docs = []
})

afterEach(() => {
  providers.forEach((provider) => provider.destroy())
  docs.forEach((doc) => doc.destroy())
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.unstubAllGlobals()
})

function peer(id = 'same-document', initialize?: (doc: Doc) => void) {
  const doc = new Doc()
  const provider = new LocalProvider(
    id,
    doc,
    { whenSynced: Promise.resolve(), destroy: async () => {} },
    initialize,
  )
  docs.push(doc)
  providers.push(provider)
  return { doc, provider }
}

it('exchanges live edits and catches up a late joining tab without feedback loops', async () => {
  const first = peer()
  first.provider.connect()
  await flushBroadcasts()
  first.doc.getText('content').insert(0, 'Hello')
  const second = peer()
  second.provider.connect()
  await flushBroadcasts()
  expect(second.doc.getText('content').toString()).toBe('Hello')
  first.doc.getText('content').insert(5, ' from first')
  second.doc.getText('content').insert(0, 'Second: ')
  await flushBroadcasts()
  expect(encodeStateAsUpdate(first.doc)).toEqual(
    encodeStateAsUpdate(second.doc),
  )
  const sent = TestBroadcastChannel.sent
  await flushBroadcasts()
  expect(TestBroadcastChannel.sent).toBe(sent)
})

it('isolates documents and removes disconnected peers from awareness', async () => {
  const first = peer()
  const second = peer()
  const other = peer('another-document')
  for (const current of [first, second, other]) current.provider.connect()
  await flushBroadcasts()
  first.provider.awareness.setLocalStateField('name', 'First tab')
  first.doc.getText('content').insert(0, 'Private to this document')
  await flushBroadcasts()
  expect(
    second.provider.awareness.getStates().get(first.doc.clientID)?.name,
  ).toBe('First tab')
  expect(other.doc.getText('content').toString()).toBe('')
  first.provider.disconnect()
  await flushBroadcasts()
  expect(second.provider.awareness.getStates().has(first.doc.clientID)).toBe(
    false,
  )
})

it('initializes exactly one shared paragraph when two tabs open an empty document', async () => {
  const first = peer('empty', initializeDocument)
  const second = peer('empty', initializeDocument)
  first.provider.connect()
  second.provider.connect()
  await flushBroadcasts()
  expect(first.doc.get('root', XmlText).length).toBe(1)
  expect(second.doc.get('root', XmlText).length).toBe(1)
  expect(encodeStateAsUpdate(first.doc)).toEqual(
    encodeStateAsUpdate(second.doc),
  )
})

it('does not leak channels when connecting again before persistence finishes loading', async () => {
  const first = peer()
  first.provider.connect()
  first.provider.disconnect()
  first.provider.connect()
  await flushBroadcasts()
  expect(TestBroadcastChannel.channels.size).toBe(1)
})

it('restores awareness and catches up edits after reconnecting', async () => {
  const first = peer()
  const second = peer()
  first.provider.connect()
  second.provider.connect()
  await flushBroadcasts()
  first.provider.awareness.setLocalStateField('name', 'Returning tab')
  first.provider.disconnect()
  second.doc.getText('content').insert(0, 'While disconnected')
  first.provider.connect()
  await flushBroadcasts()
  expect(first.doc.getText('content').toString()).toBe('While disconnected')
  expect(
    second.provider.awareness.getStates().get(first.doc.clientID)?.name,
  ).toBe('Returning tab')
})

it('does not rebroadcast awareness states owned by the realtime bridge', async () => {
  const first = peer()
  first.provider.connect()
  await flushBroadcasts()
  const sent = TestBroadcastChannel.sent
  const remote = new Awareness(new Doc())
  remote.setLocalState({ name: 'Remote socket peer' })
  applyAwarenessUpdate(
    first.provider.awareness as unknown as Awareness,
    encodeAwarenessUpdate(remote, [remote.clientID]),
    Symbol('realtime-bridge'),
  )
  await flushBroadcasts()
  expect(TestBroadcastChannel.sent).toBe(sent)
  remote.destroy()
})

it('cleans up active sessions and releases content locks when persistence sync rejects', async () => {
  let sharedHeld = 0
  let lockReleased = false
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: async (
        _name: string,
        optionsOrTask:
          { mode?: string; ifAvailable?: boolean } | (() => Promise<unknown>),
        task?: (lock: object | null) => Promise<unknown>,
      ) => {
        const callback =
          typeof optionsOrTask === 'function' ? optionsOrTask : task!
        const options = typeof optionsOrTask === 'function' ? {} : optionsOrTask
        if (options.mode === 'shared') {
          sharedHeld++
          try {
            return await callback({})
          } finally {
            sharedHeld--
            lockReleased = true
          }
        }
        if (options.ifAvailable) {
          if (sharedHeld > 0) return callback(null)
          return await callback({})
        }
        return await callback({})
      },
    },
  })

  const doc = new Doc()
  docs.push(doc)
  const id = 'missing-document'
  const persistence = localDocumentStorage.open(id, doc)
  const provider = new LocalProvider(id, doc, persistence)
  providers.push(provider)

  provider.connect()
  await expect(persistence.whenSynced).rejects.toThrow('Document not found')
  await vi.waitFor(() => expect(lockReleased).toBe(true))
  expect(sharedHeld).toBe(0)

  let lockAcquired = false
  await navigator.locks.request(
    `concept-content:${id}`,
    { ifAvailable: true },
    async (lock) => {
      lockAcquired = Boolean(lock)
    },
  )
  expect(lockAcquired).toBe(true)
})
