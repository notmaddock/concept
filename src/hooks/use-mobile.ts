import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'
const listeners = new Set<() => void>()
let mediaQuery: MediaQueryList | undefined

function notify() {
  for (const listener of listeners) listener()
}

function getSnapshot() {
  if (!mediaQuery && typeof window !== 'undefined') {
    mediaQuery = window.matchMedia(MOBILE_QUERY)
  }
  return mediaQuery?.matches ?? false
}

function subscribe(listener: () => void) {
  if (!mediaQuery && typeof window !== 'undefined') {
    mediaQuery = window.matchMedia(MOBILE_QUERY)
  }
  if (listeners.size === 0) {
    mediaQuery?.addEventListener('change', notify)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      mediaQuery?.removeEventListener('change', notify)
      mediaQuery = undefined
    }
  }
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
