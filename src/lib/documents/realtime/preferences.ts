const STORAGE_KEY = 'concept:live-collaboration'

const listeners = new Set<() => void>()

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
  listeners.forEach((listener) => listener())
}

export function subscribeLiveCollaboration(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      listeners.forEach((listener) => listener())
    }
  })
}
