const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type MotionPreferenceView = {
  matchMedia?: (query: string) => { matches: boolean }
}

function prefersReducedMotion(element: HTMLElement): boolean {
  const view: MotionPreferenceView | null = element.ownerDocument.defaultView
  const matchMedia = view?.matchMedia
  if (!matchMedia) return false
  return matchMedia(REDUCED_MOTION_QUERY).matches
}

function normalizeColor(value: string | undefined, ownerDocument: Document) {
  if (!value?.trim()) return ''

  const probe = ownerDocument.createElement('span')
  probe.style.backgroundColor = value
  probe.style.display = 'none'
  ownerDocument.body.append(probe)

  try {
    const computed =
      ownerDocument.defaultView?.getComputedStyle(probe).backgroundColor
    return (computed || probe.style.backgroundColor).trim().toLowerCase()
  } finally {
    probe.remove()
  }
}

function caretName(caret: HTMLElement) {
  const label = caret.firstElementChild
  if (!label || label.tagName !== 'SPAN') return null
  return label.textContent.trim()
}

function effectiveBackgroundColor(element: HTMLElement) {
  return (
    element.ownerDocument.defaultView?.getComputedStyle(element)
      .backgroundColor || element.style.backgroundColor
  )
}

export function findCollaboratorCaret(
  container: HTMLElement | null,
  collaborator: { name?: string; color?: string },
): HTMLElement | null {
  const name = collaborator.name?.trim()
  if (!container || !name) return null

  const matches = Array.from(
    container.querySelectorAll<HTMLElement>('span'),
  ).filter((span) => caretName(span) === name)

  if (matches.length <= 1) return matches[0] ?? null

  const color = collaborator.color?.trim()
  if (color) {
    const expected = normalizeColor(color, container.ownerDocument)
    const colorMatch = matches.find(
      (span) =>
        normalizeColor(effectiveBackgroundColor(span), span.ownerDocument) ===
        expected,
    )
    if (colorMatch) return colorMatch
  }

  return matches[0]
}

export function revealCollaboratorCaret(caret: HTMLElement): void {
  const behavior: ScrollBehavior = prefersReducedMotion(caret)
    ? 'auto'
    : 'smooth'
  const main = caret.closest('main')

  if (!main) {
    caret.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
    return
  }

  const caretRect = caret.getBoundingClientRect()
  const mainRect = main.getBoundingClientRect()
  const top =
    main.scrollTop +
    caretRect.top -
    mainRect.top -
    (main.clientHeight - caretRect.height) / 2

  main.scrollTo({ top, behavior })
}
