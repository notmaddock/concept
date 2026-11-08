import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getThemeScript, ThemeProvider, useTheme } from './theme-provider'

vi.mock('@tanstack/react-router', () => ({
  ScriptOnce: () => null,
}))

let root: Root
let container: HTMLDivElement

function TestThemeConsumer() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('light')}>Set Light</button>
    </div>
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.restoreAllMocks()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('getThemeScript', () => {
  it('keeps script-closing markup and line separators inside the theme storage key', () => {
    const key = '</script><script>alert("injected")</script>\u2028\u2029'
    const script = getThemeScript(key, 'system')
    expect(script).not.toContain('<')
    expect(script).not.toContain('\u2028')
    expect(script).not.toContain('\u2029')
    const page = new DOMParser().parseFromString(
      `<script>${script}</script>`,
      'text/html',
    )
    expect(page.querySelectorAll('script')).toHaveLength(1)
    const encoded = script.match(/getItem\((.*?)\);/)![1]
    expect(JSON.parse(encoded)).toBe(key)
  })
})

describe('ThemeProvider localStorage error handling', () => {
  it('falls back to defaultTheme if localStorage.getItem throws on mount', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })

    await act(() =>
      root.render(
        <ThemeProvider defaultTheme="dark" storageKey="theme">
          <TestThemeConsumer />
        </ThemeProvider>,
      ),
    )

    expect(
      container.querySelector('[data-testid="current-theme"]')?.textContent,
    ).toBe('dark')
  })

  it('updates theme state safely when localStorage.setItem throws in setTheme', async () => {
    await act(() =>
      root.render(
        <ThemeProvider defaultTheme="light" storageKey="theme">
          <TestThemeConsumer />
        </ThemeProvider>,
      ),
    )

    expect(
      container.querySelector('[data-testid="current-theme"]')?.textContent,
    ).toBe('light')

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })

    const setDarkButton = container.querySelectorAll('button')[0]
    await act(() => setDarkButton.click())

    expect(
      container.querySelector('[data-testid="current-theme"]')?.textContent,
    ).toBe('dark')
  })

  it('initializes from localStorage when valid theme is stored', async () => {
    localStorage.setItem('theme', 'dark')

    await act(() =>
      root.render(
        <ThemeProvider defaultTheme="system" storageKey="theme">
          <TestThemeConsumer />
        </ThemeProvider>,
      ),
    )

    expect(
      container.querySelector('[data-testid="current-theme"]')?.textContent,
    ).toBe('dark')
  })

  it('persists theme to localStorage on setTheme when storage is functional', async () => {
    await act(() =>
      root.render(
        <ThemeProvider defaultTheme="system" storageKey="theme">
          <TestThemeConsumer />
        </ThemeProvider>,
      ),
    )

    const setDarkButton = container.querySelectorAll('button')[0]
    await act(() => setDarkButton.click())

    expect(localStorage.getItem('theme')).toBe('dark')
    expect(
      container.querySelector('[data-testid="current-theme"]')?.textContent,
    ).toBe('dark')
  })
})
