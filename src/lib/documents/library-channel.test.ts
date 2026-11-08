import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import {
  isDocumentChange,
  publishDocumentChange,
  subscribeToLibrary,
} from './library-channel'
import type { DocumentChange } from './storage'

let unsubscribe: (() => void) | undefined
let remote: TestBroadcastChannel

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  remote = new TestBroadcastChannel('concept-library')
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = undefined
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

it('continues notifying other listeners if one throws on remote message', async () => {
  const failingListener = vi.fn(() => {
    throw new Error('Listener error')
  })
  const successfulListener = vi.fn()
  const unsubscribe1 = subscribeToLibrary(failingListener)
  const unsubscribe2 = subscribeToLibrary(successfulListener)
  unsubscribe = () => {
    unsubscribe1()
    unsubscribe2()
  }

  const change: DocumentChange = { type: 'delete', id: 'doc-1' }
  remote.postMessage(change)
  await flushBroadcasts()

  expect(failingListener).toHaveBeenCalledWith(change)
  expect(successfulListener).toHaveBeenCalledWith(change)
})

it('ignores malformed remote messages that do not match DocumentChange shape', async () => {
  const listener = vi.fn()
  unsubscribe = subscribeToLibrary(listener)

  const malformedPayloads = [
    null,
    undefined,
    'not-an-object',
    123,
    [],
    {},
    { type: 'delete' },
    { type: 'delete', id: 123 },
    { type: 'upsert' },
    { type: 'upsert', document: null },
    { type: 'upsert', document: { id: 'doc' } },
    { type: 'upsert', document: { id: 'doc', name: 'Doc' } },
    {
      type: 'upsert',
      document: { id: 'doc', name: 'Doc', updatedAt: 'invalid' },
    },
    {
      type: 'upsert',
      document: { id: 'doc', name: 'Doc', updatedAt: Number.NaN },
    },
    { type: 'unknown', id: 'doc' },
  ]

  for (const payload of malformedPayloads) {
    remote.postMessage(payload)
  }
  await flushBroadcasts()

  expect(listener).not.toHaveBeenCalled()
})

it('defers closing ephemeral publisher and delivers broadcast to remote tabs', async () => {
  vi.useFakeTimers()
  try {
    const received = vi.fn()
    remote.onmessage = received

    const change: DocumentChange = {
      type: 'upsert',
      document: {
        id: 'doc-ephemeral',
        name: 'Doc Ephemeral',
        updatedAt: 12345,
      },
    }

    publishDocumentChange(change)
    await flushBroadcasts()

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ data: change }),
    )
    expect(TestBroadcastChannel.channels.size).toBe(2)

    vi.advanceTimersByTime(0)
    expect(TestBroadcastChannel.channels.size).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

it('validates DocumentChange shape accurately with isDocumentChange', () => {
  expect(
    isDocumentChange({
      type: 'upsert',
      document: { id: '1', name: 'Test', updatedAt: 100 },
    }),
  ).toBe(true)

  expect(isDocumentChange({ type: 'delete', id: '1' })).toBe(true)

  expect(isDocumentChange(null)).toBe(false)
  expect(isDocumentChange(undefined)).toBe(false)
  expect(isDocumentChange(42)).toBe(false)
  expect(isDocumentChange('string')).toBe(false)
  expect(isDocumentChange([])).toBe(false)
  expect(isDocumentChange({})).toBe(false)
  expect(isDocumentChange({ type: 'delete' })).toBe(false)
  expect(isDocumentChange({ type: 'delete', id: 999 })).toBe(false)
  expect(isDocumentChange({ type: 'upsert' })).toBe(false)
  expect(isDocumentChange({ type: 'upsert', document: [] })).toBe(false)
  expect(
    isDocumentChange({
      type: 'upsert',
      document: { id: '1', name: 'Test' },
    }),
  ).toBe(false)
  expect(
    isDocumentChange({
      type: 'upsert',
      document: { id: '1', name: 'Test', updatedAt: Number.NaN },
    }),
  ).toBe(false)
})
