export interface ListenerSet {
  subscribe: (listener: () => void) => () => void
  notify: () => void
  clear: () => void
  readonly size: number
}

export function createListenerSet(): ListenerSet {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify() {
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // Isolate listener exceptions
        }
      }
    },
    clear() {
      listeners.clear()
    },
    get size() {
      return listeners.size
    },
  }
}
