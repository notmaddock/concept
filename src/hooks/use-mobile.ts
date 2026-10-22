import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'
const listeners = new Set<() => void>()
let mediaQuery: MediaQueryList | undefined

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia(MOBILE_QUERY)
    mediaQuery.addEventListener('change', notify)
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
  return useSyncExternalStore(
    subscribe,
    () => mediaQuery?.matches ?? false,
    () => false,
  )
}
