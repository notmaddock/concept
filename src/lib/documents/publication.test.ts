// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from '#/test/broadcast-channel'
import {
  isPublicationHint,
  openPublicationTransport,
  publicationPolicy,
} from './publication'
import type { PublicationHint, PublicationTransport } from './publication'

const fileId = 'authorized-document'
const revision = 'a'.repeat(64)
const hint = (validator = 'opaque-etag'): PublicationHint => ({
  protocol: 1,
  storage: 'google-drive',
  fileId,
  validator,
  revision,
})
let remote: TestBroadcastChannel
let transport: PublicationTransport
const defaults = { ...publicationPolicy }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  remote = new TestBroadcastChannel(`concept-publication:${fileId}`)
  transport = openPublicationTransport(fileId)!
})
afterEach(() => {
  transport.close()
  remote.close()
  expect(TestBroadcastChannel.channels.size).toBe(0)
  Object.assign(publicationPolicy, defaults)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('requires matching membership, protocol, storage kind, bounded validators and canonical revisions', async () => {
  const listener = vi.fn()
  transport.subscribe(listener)
  for (const invalid of [
    null,
    {},
    { ...hint(), fileId: 'other-document' },
    { ...hint(), protocol: 2 },
    { ...hint(), storage: 'arbitrary-url' },
    { ...hint(), validator: '' },
    { ...hint(), validator: 'x'.repeat(1025) },
    { ...hint(), revision: 'A'.repeat(64) },
    { ...hint(), revision: 'http://attacker.invalid/download' },
  ]) {
    expect(isPublicationHint(invalid, fileId)).toBe(false)
    remote.postMessage(invalid)
  }
  await flushBroadcasts()
  expect(listener).not.toHaveBeenCalled()
  remote.postMessage(hint())
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledOnce()
})

it('treats validators as opaque, deduplicates receipts, and rate-limits checks without ordering ETags', async () => {
  const listener = vi.fn()
  transport.subscribe(listener)
  remote.postMessage(hint('z-last-lexically'))
  await flushBroadcasts()
  remote.postMessage(hint('z-last-lexically'))
  remote.postMessage(hint('middle-during-cooldown'))
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(publicationPolicy.minimumCheckMs)
  remote.postMessage(hint('a-first-lexically'))
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledTimes(2)
  expect(listener).toHaveBeenLastCalledWith(hint('a-first-lexically'))
  await vi.advanceTimersByTimeAsync(publicationPolicy.minimumCheckMs)
  remote.postMessage(hint('z-last-lexically'))
  await flushBroadcasts()
  expect(listener).toHaveBeenCalledTimes(2)
})

it('ignores peer-supplied download URLs and exposes only a document publication receipt', async () => {
  const listener = vi.fn()
  transport.subscribe(listener)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  remote.postMessage({
    ...hint(),
    url: 'https://attacker.invalid/private-assets',
    downloadUrl: 'https://attacker.invalid/anything',
  })
  await flushBroadcasts()
  expect(fetch).not.toHaveBeenCalled()
  expect(listener).toHaveBeenCalledWith(hint())
})

it('broadcasts only valid matching receipts, unsubscribes and becomes inert after close', async () => {
  const received = vi.fn()
  remote.onmessage = received
  const listener = vi.fn()
  const unsubscribe = transport.subscribe(listener)
  transport.publish({ ...hint(), fileId: 'other-document' })
  transport.publish(hint())
  await flushBroadcasts()
  expect(received).toHaveBeenCalledOnce()
  unsubscribe()
  remote.postMessage(hint('another'))
  await flushBroadcasts()
  expect(listener).not.toHaveBeenCalled()
  transport.close()
  transport.subscribe(listener)
  transport.publish(hint('after-close'))
  remote.postMessage(hint('after-close'))
  await flushBroadcasts()
  expect(received).toHaveBeenCalledOnce()
  expect(listener).not.toHaveBeenCalled()
})

it('keeps receipt deduplication bounded and works without a notification adapter', async () => {
  publicationPolicy.rememberedTokens = 2
  publicationPolicy.minimumCheckMs = 0
  const listener = vi.fn()
  transport.subscribe(listener)
  for (const validator of ['one', 'two', 'three', 'one']) {
    remote.postMessage(hint(validator))
    await flushBroadcasts()
  }
  expect(listener).toHaveBeenCalledTimes(4)
  vi.stubGlobal('BroadcastChannel', undefined)
  expect(openPublicationTransport(fileId)).toBeUndefined()
})
