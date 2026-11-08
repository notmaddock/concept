import type { DocumentChange } from './storage'

const listeners = new Set<(change: DocumentChange) => void>()
let channel: BroadcastChannel | undefined

export function isDocumentChange(value: unknown): value is DocumentChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'delete') {
    return typeof candidate.id === 'string'
  }
  if (candidate.type === 'upsert') {
    if (
      !candidate.document ||
      typeof candidate.document !== 'object' ||
      Array.isArray(candidate.document)
    ) {
      return false
    }
    const doc = candidate.document as Record<string, unknown>
    return (
      typeof doc.id === 'string' &&
      typeof doc.name === 'string' &&
      typeof doc.updatedAt === 'number' &&
      !Number.isNaN(doc.updatedAt)
    )
  }
  return false
}

export function subscribeToLibrary(listener: (change: DocumentChange) => void) {
  listeners.add(listener)
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('concept-library')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (!isDocumentChange(data)) return
      listeners.forEach((callback) => {
        try {
          callback(data)
        } catch {}
      })
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
  if (!channel) {
    setTimeout(() => publisher.close(), 0)
  }
}
