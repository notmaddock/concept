import { afterEach, expect, it, vi } from 'vitest'
import {
  applyDocumentTheme,
  rememberThemeOrigin,
  resetDocumentTheme,
} from './theme-transition'

function mockTransitions() {
  const transitions: Array<{
    update: () => void
    ready: Promise<void>
    finish: () => void
    skipTransition: ReturnType<typeof vi.fn>
  }> = []
  const animate = vi.fn()
  vi.spyOn(document.documentElement, 'animate').mockImplementation(animate)
  vi.spyOn(document, 'startViewTransition').mockImplementation((update) => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const transition = {
      update: update as () => void,
      ready: Promise.resolve(),
      finished,
      finish,
      skipTransition: vi.fn(finish),
    }
    transitions.push(transition)
    return transition as unknown as ViewTransition
  })
  return { transitions, animate }
}

afterEach(() => {
  resetDocumentTheme()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).startViewTransition
  delete (document.documentElement as Partial<HTMLElement>).animate
})

it('uses immediate updates for unsupported browsers and reduced motion', () => {
  applyDocumentTheme('red')
  expect(document.documentElement.dataset.documentTheme).toBe('red')
  const start = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: start,
  })
  applyDocumentTheme('blue')
  expect(start).not.toHaveBeenCalled()
  expect(document.documentElement.dataset.documentTheme).toBe('blue')
  delete (document as Partial<Document>).startViewTransition
})

it('reveals from the clicked item and covers the furthest viewport corner', async () => {
  // jsdom does not implement these APIs yet.
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: () => {},
  })
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    writable: true,
    value: () => {},
  })
  const { transitions, animate } = mockTransitions()
  rememberThemeOrigin({
    clientX: 20,
    clientY: 40,
    detail: 1,
    currentTarget: null,
  })
  applyDocumentTheme('pink')
  transitions[0].update()
  await transitions[0].ready
  expect(document.documentElement.dataset.documentTheme).toBe('pink')
  const radius = Math.hypot(innerWidth - 20, innerHeight - 40)
  expect(animate).toHaveBeenCalledWith(
    {
      clipPath: [
        'circle(0px at 20px 40px)',
        `circle(${radius}px at 20px 40px)`,
      ],
    },
    expect.objectContaining({
      pseudoElement: '::view-transition-new(root)',
    }),
  )
  transitions[0].finish()
  delete (document as Partial<Document>).startViewTransition
})

it('prevents a superseded transition from applying a stale palette', async () => {
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: () => {},
  })
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    writable: true,
    value: () => {},
  })
  const { transitions } = mockTransitions()
  applyDocumentTheme('red')
  applyDocumentTheme('green')
  transitions[1].update()
  transitions[0].update()
  await Promise.resolve()
  expect(transitions[0].skipTransition).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.documentTheme).toBe('green')
  transitions[1].finish()
  delete (document as Partial<Document>).startViewTransition
})

it("does not throw in SSR environments when document is undefined (SSR-01)", () => {
  const originalDoc = globalThis.document
  try {
    // @ts-expect-error test SSR environment without document
    delete globalThis.document
    expect(() => applyDocumentTheme("red")).not.toThrow()
    expect(() => resetDocumentTheme()).not.toThrow()
    expect(() =>
      rememberThemeOrigin({
        clientX: 0,
        clientY: 0,
        detail: 0,
        currentTarget: null,
      }),
    ).not.toThrow()
  } finally {
    globalThis.document = originalDoc
  }
})
