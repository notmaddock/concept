import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { ThemeProvider, useTheme } from './theme-provider'

vi.mock('@tanstack/react-router', () => ({ ScriptOnce: () => null }))

let root: Root
let container: HTMLDivElement
function Harness() {
  const { theme, setTheme } = useTheme()
  return <button onClick={() => setTheme('dark')}>{theme}</button>
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark', 'light')
})

it('opens the app using the default theme when preference reads are blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError')
  })
  await act(() =>
    root.render(
      <ThemeProvider defaultTheme="light">
        <Harness />
      </ThemeProvider>,
    ),
  )
  expect(container.textContent).toBe('light')
  expect(document.documentElement.classList.contains('light')).toBe(true)
})

it('applies a theme even when saving the preference fails', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('light')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage full', 'QuotaExceededError')
  })
  await act(() =>
    root.render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    ),
  )
  await act(() => container.querySelector('button')!.click())
  expect(container.textContent).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
