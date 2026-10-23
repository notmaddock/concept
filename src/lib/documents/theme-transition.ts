import type { DocumentTheme } from './document-theme'

type Origin = { x: number; y: number }
let pendingOrigin: { point: Origin; expires: number } | undefined
let active: ViewTransition | undefined
let revision = 0
// Keyboard activation uses the center of the activated item.
export function rememberThemeOrigin(event: {
  clientX: number
  clientY: number
  detail: number
  currentTarget: EventTarget | null
}) {
  const bounds = (
    event.currentTarget as Element | null
  )?.getBoundingClientRect()
  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  pendingOrigin = {
    point:
      event.detail === 0 && bounds
        ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        : { x: event.clientX, y: event.clientY },
    expires: now + 5000,
  }
}

export function resetDocumentTheme() {
  if (typeof document === 'undefined') return
  revision++
  active?.skipTransition()
  active = undefined
  pendingOrigin = undefined
  delete document.documentElement.dataset.themeTransition
  delete document.documentElement.dataset.documentTheme
}

export function applyDocumentTheme(theme: DocumentTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const defaultCenter =
    typeof window !== 'undefined'
      ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      : { x: 0, y: 0 }
  const origin =
    pendingOrigin && pendingOrigin.expires > now
      ? pendingOrigin.point
      : defaultCenter
  pendingOrigin = undefined
  const currentRevision = ++revision
  active?.skipTransition()
  active = undefined
  delete root.dataset.themeTransition
  if ((root.dataset.documentTheme ?? 'default') === theme) return

  const update = () => {
    if (currentRevision === revision) root.dataset.documentTheme = theme
  }

  if (
    typeof document.startViewTransition !== 'function' ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    update()
    return
  }

  const transition = document.startViewTransition(update)
  active = transition
  root.dataset.themeTransition = 'active'
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 0
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0
  const radius = Math.hypot(
    Math.max(origin.x, windowWidth - origin.x),
    Math.max(origin.y, windowHeight - origin.y),
  )

  void transition.ready
    .then(() => {
      if (active !== transition) return
      root.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration: 350,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {})
    .finally(() => {
      // Skipped/interrupted transitions still apply the newest document palette.
      if (active === transition) {
        delete root.dataset.themeTransition
        active = undefined
      }
    })
}
