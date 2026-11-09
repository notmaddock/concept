import { useCallback, useSyncExternalStore } from 'react'
import type { ListenerSet } from '#/lib/listener'
import { createListenerSet } from '#/lib/listener'

interface QuerySubscription {
  listeners: ListenerSet
  mediaQuery: MediaQueryList
  cleanup: () => void
}

const subscriptions = new Map<string, QuerySubscription>()

function getSubscription(query: string): QuerySubscription {
  let sub = subscriptions.get(query)
  if (!sub) {
    const listeners = createListenerSet()
    const mediaQuery = window.matchMedia(query)
    mediaQuery.addEventListener('change', listeners.notify)
    sub = {
      listeners,
      mediaQuery,
      cleanup: () => {
        mediaQuery.removeEventListener('change', listeners.notify)
        subscriptions.delete(query)
      },
    }
    subscriptions.set(query, sub)
  }
  return sub
}

function subscribeQuery(query: string, notify: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return () => {}
  const sub = getSubscription(query)
  const unsubscribe = sub.listeners.subscribe(notify)
  return () => {
    unsubscribe()
    if (sub.listeners.size === 0) {
      sub.cleanup()
    }
  }
}

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => subscribeQuery(query, notify),
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => {
      if (
        typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function'
      )
        return false
      return subscriptions.get(query)?.mediaQuery.matches ?? false
    },
    () => false,
  )
}
