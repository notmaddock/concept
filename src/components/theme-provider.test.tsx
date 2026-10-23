import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { ThemeProvider, getThemeScript, useTheme } from './theme-provider'

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
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark', 'light')
})

it('opens the app using the default theme when preference reads are blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError')
  })
  await act(async () =>
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
  await act(async () =>
    root.render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    ),
  )
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})

it('applies fallback theme during bootstrap script execution when storage access throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError')
  })
  const script = getThemeScript('theme', 'dark')
  new Function(script)()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(document.documentElement.style.colorScheme).toBe('dark')
})

it('synchronizes theme changes across tabs via storage events', async () => {
  await act(async () =>
    root.render(
      <ThemeProvider defaultTheme="light" storageKey="theme">
        <Harness />
      </ThemeProvider>,
    ),
  )
  expect(container.textContent).toBe('light')

  // Receive storage event from another tab updating to 'dark'
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: 'dark',
      }),
    )
  })
  expect(container.textContent).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)

  // Unrelated storage event is ignored
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'other-key',
        newValue: 'light',
      }),
    )
  })
  expect(container.textContent).toBe('dark')

  // Storage event with null resets to defaultTheme
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: null,
      }),
    )
  })
  expect(container.textContent).toBe('light')
  expect(document.documentElement.classList.contains('light')).toBe(true)

  // Invalid storage value is ignored
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: 'invalid-theme',
      }),
    )
  })
  expect(container.textContent).toBe('light')
})
