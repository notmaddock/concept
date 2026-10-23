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
  pendingOrigin = {
    point:
      event.detail === 0 && bounds
        ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        : { x: event.clientX, y: event.clientY },
    expires: performance.now() + 5000,
  }
}

export function resetDocumentTheme() {
  revision++
  active?.skipTransition()
  active = undefined
  pendingOrigin = undefined
  delete document.documentElement.dataset.themeTransition
  delete document.documentElement.dataset.documentTheme
}

export function applyDocumentTheme(theme: DocumentTheme) {
  const root = document.documentElement
  const origin =
    pendingOrigin && pendingOrigin.expires > performance.now()
      ? pendingOrigin.point
      : { x: innerWidth / 2, y: innerHeight / 2 }
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
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    update()
    return
  }

  root.dataset.themeTransition = ''
  const transition = document.startViewTransition(update)
  active = transition
  void transition.ready
    .then(() => {
      if (currentRevision !== revision) return
      const radius = Math.hypot(
        Math.max(origin.x, innerWidth - origin.x),
        Math.max(origin.y, innerHeight - origin.y),
      )
      root.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
          fill: 'both',
        },
      )
    })
    .catch(() => {
      // Skipped/interrupted transitions still apply the newest document palette.
    })
  void transition.finished
    .catch(() => {})
    .finally(() => {
      if (active !== transition) return
      active = undefined
      delete root.dataset.themeTransition
    })
}
