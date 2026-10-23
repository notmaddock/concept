export class TestBroadcastChannel {
  static channels = new Set<TestBroadcastChannel>()
  static sent = 0
  static pending = 0
  private static generation = 0
  onmessage: ((event: MessageEvent) => void) | null = null

  static reset() {
    TestBroadcastChannel.generation++
    for (const channel of [...TestBroadcastChannel.channels]) channel.close()
    TestBroadcastChannel.channels.clear()
    TestBroadcastChannel.sent = 0
    TestBroadcastChannel.pending = 0
  }

  constructor(readonly name: string) {
    TestBroadcastChannel.channels.add(this)
  }

  postMessage(data: unknown) {
    TestBroadcastChannel.sent++
    for (const peer of TestBroadcastChannel.channels) {
      if (peer !== this && peer.name === this.name) {
        const generation = TestBroadcastChannel.generation
        TestBroadcastChannel.pending++
        queueMicrotask(() => {
          try {
            if (
              generation === TestBroadcastChannel.generation &&
              TestBroadcastChannel.channels.has(peer)
            )
              peer.onmessage?.({ data: structuredClone(data) } as MessageEvent)
          } finally {
            if (generation === TestBroadcastChannel.generation)
              TestBroadcastChannel.pending--
          }
        })
      }
    }
  }

  close() {
    TestBroadcastChannel.channels.delete(this)
  }
}

export async function flushBroadcasts() {
  do {
    await Promise.resolve()
    while (TestBroadcastChannel.pending > 0) {
      await Promise.resolve()
    }
    await Promise.resolve()
  } while (TestBroadcastChannel.pending > 0)
}
