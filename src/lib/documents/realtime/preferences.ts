import { createListenerSet } from '#/lib/listener'

const STORAGE_KEY = 'concept:live-collaboration'

const listeners = createListenerSet()

function getStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function isLiveCollaborationEnabled(): boolean {
  try {
    return getStorage()?.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setLiveCollaborationEnabled(enabled: boolean): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage unavailable (private browsing, quota): preference stays session-local.
  }
  listeners.notify()
}

export function subscribeLiveCollaboration(listener: () => void): () => void {
  return listeners.subscribe(listener)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      listeners.notify()
    }
  })
}
