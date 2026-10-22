import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Doc, XmlText, encodeStateAsUpdate } from 'yjs'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import { LocalProvider } from './local-provider'
import { initializeDocument } from './initial-document'

let providers: Array<LocalProvider>
let docs: Array<Doc>

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
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
