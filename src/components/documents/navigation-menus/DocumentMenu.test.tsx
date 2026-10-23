import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { DocumentNavigation } from '../DocumentNavigation'

vi.mock('../document-workspace-context', () => ({
  useDocumentWorkspace: () => ({ enabled: true }),
}))
vi.mock('../DocumentActionSearch', () => ({ DocumentActionSearch: () => null }))
vi.mock('./document-navigation-options', () => ({
  useDocumentNavigationOptions: () => ({
    menus: ['File', 'Edit', 'View', 'Insert'].map((label) => ({
      label,
      items: [],
    })),
    options: [],
  }),
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('keeps the destination menu open when hover skips a menu', async () => {
  await act(() => root.render(<DocumentNavigation />))
  const triggers = Array.from(container.querySelectorAll('button'))
  await act(() => {
    triggers[0].dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0, detail: 0 }),
    )
  })
  expect(triggers[0].getAttribute('aria-expanded')).toBe('true')
  for (const index of [2, 3, 0, 2]) {
    await act(async () => {
      const pointer = new MouseEvent('pointerenter', { bubbles: true })
      Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
      triggers[index].dispatchEvent(pointer)
      const over = new MouseEvent('pointerover', { bubbles: true })
      Object.defineProperty(over, 'pointerType', { value: 'mouse' })
      triggers[index].dispatchEvent(over)
      triggers[index].dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      )
      triggers[index].dispatchEvent(
        new MouseEvent('mouseenter', { bubbles: false }),
      )
      triggers[index].dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(triggers[index].getAttribute('aria-expanded')).toBe('true')
  }
})

it('requires a click before hover and after dismissal', async () => {
  await act(() => root.render(<DocumentNavigation />))
  const triggers = Array.from(container.querySelectorAll('button'))
  await act(() =>
    triggers[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })),
  )
  expect(
    triggers.every(
      (trigger) => trigger.getAttribute('aria-expanded') === 'false',
    ),
  ).toBe(true)
  await act(() => triggers[0].click())
  expect(triggers[0].getAttribute('aria-expanded')).toBe('true')
  await act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  await act(() =>
    triggers[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })),
  )
  expect(
    triggers.every(
      (trigger) => trigger.getAttribute('aria-expanded') === 'false',
    ),
  ).toBe(true)
})
