export class TestBroadcastChannel {
  static channels = new Set<TestBroadcastChannel>()
  static sent = 0
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    TestBroadcastChannel.channels.add(this)
  }

  postMessage(data: unknown) {
    TestBroadcastChannel.sent++
    for (const peer of TestBroadcastChannel.channels) {
      if (peer !== this && peer.name === this.name) {
        queueMicrotask(() => {
          if (TestBroadcastChannel.channels.has(peer))
            peer.onmessage?.({ data: structuredClone(data) } as MessageEvent)
        })
      }
    }
  }

  close() {
    TestBroadcastChannel.channels.delete(this)
  }
}

export async function flushBroadcasts() {
  for (let step = 0; step < 12; step++) await Promise.resolve()
}
