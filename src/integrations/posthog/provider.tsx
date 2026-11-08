import { useEffect } from 'react'
import { afterPageLoad } from '#/lib/loading/after-page-load'
import type { ReactNode } from 'react'

let initialization: Promise<unknown> | undefined

/**
 * The ingestion host answers API calls; the app host is where PostHog links
 * point. They differ by the `i.` label (`us.i.posthog.com` → `us.posthog.com`),
 * so derive the app host from the configured ingestion host to keep EU and
 * self-hosted deployments pointing at their own region.
 */
function posthogUiHost(apiHost: string) {
  try {
    const url = new URL(apiHost)
    // Read the hostname back: `origin` reports the host parsed at construction.
    const hostname = url.hostname.replace(/\.i\.posthog\.com$/, '.posthog.com')
    return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return undefined
  }
}

export default function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!import.meta.env.VITE_POSTHOG_KEY) return
    return afterPageLoad(() => {
      initialization ??= import('posthog-js')
        .then(({ default: posthog }) => {
          const apiHost =
            import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
          posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
            api_host: apiHost,
            ui_host: posthogUiHost(apiHost),
            autocapture: false,
            disable_session_recording: true,
            mask_all_text: true,
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
