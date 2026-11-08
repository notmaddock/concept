import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { init, schedule, cancel } = vi.hoisted(() => ({
  init: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('posthog-js', () => ({ default: { init } }))
vi.mock('#/lib/loading/after-page-load', () => ({ afterPageLoad: schedule }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_POSTHOG_KEY', 'test-key')
  schedule.mockReturnValue(cancel)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllEnvs()
})

it('renders children immediately and initializes analytics only in the scheduled task', async () => {
  // Dynamic import exercises module reload after vi.resetModules() for isolated initialization state
  const { default: Provider } = await import('./provider')
  await act(() => root.render(<Provider>Editor</Provider>))
  expect(container.textContent).toBe('Editor')
  expect(init).not.toHaveBeenCalled()
  expect(schedule).toHaveBeenCalledOnce()
  await schedule.mock.calls[0][0]()
  expect(init).toHaveBeenCalledWith(
    'test-key',
    expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      ui_host: 'https://us.posthog.com',
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: true,
      person_profiles: 'identified_only',
      capture_pageview: false,
      defaults: '2026-08-30',
    }),
  )
  await act(() => root.unmount())
  expect(cancel).toHaveBeenCalledOnce()
})

it('does not schedule analytics when no key is configured', async () => {
  vi.stubEnv('VITE_POSTHOG_KEY', '')
  // Dynamic import exercises module reload after vi.resetModules() for isolated initialization state
  const { default: Provider } = await import('./provider')
  await act(() => root.render(<Provider>Editor</Provider>))
  expect(schedule).not.toHaveBeenCalled()
  expect(init).not.toHaveBeenCalled()
})

it.each([
  ['https://us.i.posthog.com', 'https://us.posthog.com'],
  ['https://eu.i.posthog.com', 'https://eu.posthog.com'],
  ['https://analytics.example.com', 'https://analytics.example.com'],
])('points the PostHog app host at %s region', async (apiHost, uiHost) => {
  vi.stubEnv('VITE_POSTHOG_HOST', apiHost)
  const { default: Provider } = await import('./provider')
  await act(() => root.render(<Provider>Editor</Provider>))
  await schedule.mock.calls[0][0]()
  expect(init).toHaveBeenCalledWith(
    'test-key',
    expect.objectContaining({
      api_host: apiHost,
      ui_host: uiHost,
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: true,
    }),
  )
})
