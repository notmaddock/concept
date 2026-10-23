// @vitest-environment node
import { expect, it } from 'vitest'
import { TestBroadcastChannel, flushBroadcasts } from './broadcast-channel'

it('drains cascading message delivery beyond a fixed microtask count', async () => {
  const first = new TestBroadcastChannel('cascade')
  const second = new TestBroadcastChannel('cascade')
  const receive =
    (channel: TestBroadcastChannel) => (event: MessageEvent<number>) => {
      if (event.data < 30) channel.postMessage(event.data + 1)
    }
  first.onmessage = receive(first)
  second.onmessage = receive(second)
  first.postMessage(0)
  await flushBroadcasts()
  expect(TestBroadcastChannel.sent).toBe(31)
  expect(TestBroadcastChannel.pending).toBe(0)
})

it('discards queued deliveries on reset without corrupting new pending counts', async () => {
  const first = new TestBroadcastChannel('reset')
  new TestBroadcastChannel('reset')
  first.postMessage('stale')
  TestBroadcastChannel.reset()
  await flushBroadcasts()
  expect(TestBroadcastChannel.pending).toBe(0)
  expect(TestBroadcastChannel.channels.size).toBe(0)
})
