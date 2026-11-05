import type { DocumentChange } from './storage'

const listeners = new Set<(change: DocumentChange) => void>()
let channel: BroadcastChannel | undefined

export function subscribeToLibrary(listener: (change: DocumentChange) => void) {
  listeners.add(listener)
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('concept-library')
    channel.onmessage = (event: MessageEvent<DocumentChange>) => {
      listeners.forEach((callback) => callback(event.data))
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      channel?.close()
      channel = undefined
    }
  }
}

export function publishDocumentChange(change: DocumentChange) {
  listeners.forEach((listener) => {
    try {
      listener(change)
    } catch {}
  })
  if (typeof BroadcastChannel === 'undefined') return
  const publisher = channel ?? new BroadcastChannel('concept-library')
  publisher.postMessage(change)
  if (!channel) publisher.close()
}
