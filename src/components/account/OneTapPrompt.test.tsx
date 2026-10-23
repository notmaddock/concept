import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { OneTapPrompt } from './OneTapPrompt'

const { state, oneTap, refetch, toastError } = vi.hoisted(() => ({
  state: {
    session: null as { user: { id: string } } | null,
    pending: false,
    error: null as Error | null,
  },
  oneTap: vi.fn(),
  refetch: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('#/env', () => ({
  env: { VITE_GOOGLE_CLIENT_ID: 'public-google-client-id' },
}))
vi.mock('#/lib/auth/client', () => ({
  authClient: {
    oneTap,
    useSession: () => ({
      data: state.session,
      isPending: state.pending,
      error: state.error,
      refetch,
    }),
  },
}))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  state.session = null
  state.pending = false
  state.error = null
  oneTap.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

it('prompts once after session loading finishes, without rendering a Google button', async () => {
  state.pending = true
  await act(() => root.render(<OneTapPrompt />))
  expect(oneTap).not.toHaveBeenCalled()
  state.pending = false
  await act(() => root.render(<OneTapPrompt />))
  expect(oneTap).toHaveBeenCalledOnce()
  expect(oneTap.mock.calls[0][0]).not.toHaveProperty('button')
  expect(oneTap.mock.calls[0][0]).not.toHaveProperty('callbackURL')
  expect(container.textContent).toBe('')
  await act(() => root.render(<OneTapPrompt />))
  expect(oneTap).toHaveBeenCalledOnce()
})

it('does not prompt signed-in users or when session lookup fails', async () => {
  state.session = { user: { id: 'user-1' } }
  await act(() => root.render(<OneTapPrompt />))
  expect(oneTap).not.toHaveBeenCalled()
  state.session = null
  state.error = new Error('offline')
  await act(() => root.render(<OneTapPrompt />))
  expect(oneTap).not.toHaveBeenCalled()
})

it('refreshes the session on success and reports authentication errors through Sonner', async () => {
  await act(() => root.render(<OneTapPrompt />))
  const { fetchOptions } = oneTap.mock.calls[0][0]
  fetchOptions.onSuccess()
  expect(refetch).toHaveBeenCalledOnce()
  fetchOptions.onError({ error: { message: 'Could not sign in' } })
  expect(toastError).toHaveBeenCalledWith('Could not sign in')
})

it('keeps the fallback login available when the prompt is blocked', async () => {
  oneTap.mockRejectedValue(new Error('Script blocked'))
  await act(() => root.render(<OneTapPrompt />))
  expect(toastError).not.toHaveBeenCalled()
})
