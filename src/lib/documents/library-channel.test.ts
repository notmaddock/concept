import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import { publishDocumentChange, subscribeToLibrary } from './library-channel'
import type { DocumentChange } from './storage'

let unsubscribe: () => void
let remote: TestBroadcastChannel

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  remote = new TestBroadcastChannel('concept-library')
})

afterEach(() => {
  unsubscribe()
  remote.close()
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.unstubAllGlobals()
})

it('delivers local mutations to subscribers and broadcasts them to other tabs', async () => {
  const listener = vi.fn()
  const received = vi.fn()
  unsubscribe = subscribeToLibrary(listener)
  remote.onmessage = received
  const change: DocumentChange = {
    type: 'upsert',
    document: { id: 'doc', name: 'Renamed', updatedAt: 1 },
  }
  publishDocumentChange(change)
  expect(listener).toHaveBeenCalledWith(change)
  await flushBroadcasts()
  expect(received).toHaveBeenCalledWith(
    expect.objectContaining({ data: change }),
  )
})

it('delivers remote deletion immediately without echoing it back', async () => {
  const listener = vi.fn()
  unsubscribe = subscribeToLibrary(listener)
  const change: DocumentChange = { type: 'delete', id: 'doc' }
  const received = vi.fn()
  remote.onmessage = received
  remote.postMessage(change)
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledWith(change)
  expect(received).not.toHaveBeenCalled()
})
