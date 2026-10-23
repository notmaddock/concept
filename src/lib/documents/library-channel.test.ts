import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import { publishDocumentChange, subscribeToLibrary } from './library-channel'
import type { DocumentChange } from './storage'

let unsubscribes: Array<() => void> = []
let remote: TestBroadcastChannel | undefined

beforeEach(() => {
  unsubscribes = []
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  TestBroadcastChannel.reset()
  remote = new TestBroadcastChannel('concept-library')
})

afterEach(() => {
  unsubscribes.forEach((unsub) => unsub())
  unsubscribes = []
  remote?.close()
  expect(TestBroadcastChannel.channels.size).toBe(0)
  vi.unstubAllGlobals()
})

it('delivers local mutations to subscribers and broadcasts them to other tabs', async () => {
  const listener = vi.fn()
  const received = vi.fn()
  unsubscribes.push(subscribeToLibrary(listener))
  remote!.onmessage = received
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
  unsubscribes.push(subscribeToLibrary(listener))
  const change: DocumentChange = { type: 'delete', id: 'doc' }
  const received = vi.fn()
  remote!.onmessage = received
  remote!.postMessage(change)
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledWith(change)
  expect(received).not.toHaveBeenCalled()
})

it('continues notification to remaining listeners and broadcasts even if a local listener throws', async () => {
  const failingListener = vi.fn(() => {
    throw new Error('Listener failed')
  })
  const succeedingListener = vi.fn()
  const received = vi.fn()
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  unsubscribes.push(subscribeToLibrary(failingListener))
  unsubscribes.push(subscribeToLibrary(succeedingListener))
  remote!.onmessage = received

  const change: DocumentChange = {
    type: 'upsert',
    document: { id: 'doc-error-test', name: 'Error Test', updatedAt: 2 },
  }
  publishDocumentChange(change)

  expect(failingListener).toHaveBeenCalledWith(change)
  expect(succeedingListener).toHaveBeenCalledWith(change)
  expect(consoleSpy).toHaveBeenCalledWith(
    'Library channel listener error:',
    expect.any(Error),
  )

  await flushBroadcasts()
  expect(received).toHaveBeenCalledWith(
    expect.objectContaining({ data: change }),
  )
  consoleSpy.mockRestore()
})

it('continues delivering remote messages to remaining listeners even if one throws', async () => {
  const failingListener = vi.fn(() => {
    throw new Error('Remote callback failed')
  })
  const succeedingListener = vi.fn()
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  unsubscribes.push(subscribeToLibrary(failingListener))
  unsubscribes.push(subscribeToLibrary(succeedingListener))

  const change: DocumentChange = {
    type: 'upsert',
    document: { id: 'remote-doc', name: 'Remote', updatedAt: 3 },
  }
  remote!.postMessage(change)
  await flushBroadcasts()

  expect(failingListener).toHaveBeenCalledWith(change)
  expect(succeedingListener).toHaveBeenCalledWith(change)
  expect(consoleSpy).toHaveBeenCalledWith(
    'Library channel listener error:',
    expect.any(Error),
  )
  consoleSpy.mockRestore()
})
