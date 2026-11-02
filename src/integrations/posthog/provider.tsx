import { useEffect } from 'react'
import { afterPageLoad } from '#/lib/loading/after-page-load'
import type { ReactNode } from 'react'

let initialization: Promise<unknown> | undefined

export default function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!import.meta.env.VITE_POSTHOG_KEY) return
    return afterPageLoad(() => {
      initialization ??= import('posthog-js')
        .then(({ default: posthog }) => {
          posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
            api_host:
              import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
            ui_host: 'https://googl.com.org',
            person_profiles: 'identified_only',
            capture_pageview: false,
            defaults: '2026-08-30',
          })
        })
        .catch(() => {
          initialization = undefined
        })
      return initialization
    })
  }, [])

  return children
}
