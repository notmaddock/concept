import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useIsMobile } from './use-mobile'

it('shares one responsive subscription and releases it after the last consumer', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let onChange: (() => void) | undefined
  const media = {
    matches: false,
    addEventListener: vi.fn((_: string, listener: () => void) => {
      onChange = listener
    }),
    removeEventListener: vi.fn(),
  }
  const matchMedia = vi.fn(() => media)
  vi.stubGlobal('matchMedia', matchMedia)
  const container = document.createElement('div')
  const root = createRoot(container)
  function Consumer() {
    return <span>{useIsMobile() ? 'mobile' : 'desktop'}</span>
  }
  try {
    await act(() =>
      root.render(
        <>
          <Consumer />
          <Consumer />
          <Consumer />
        </>,
      ),
    )
    expect(matchMedia).toHaveBeenCalledTimes(1)
    expect(media.addEventListener).toHaveBeenCalledTimes(1)
    await act(() => {
      media.matches = true
      onChange?.()
    })
    expect(container.textContent).toBe('mobilemobilemobile')
    await act(() => root.render(<Consumer />))
    expect(media.removeEventListener).not.toHaveBeenCalled()
  } finally {
    await act(() => root.unmount())
    vi.unstubAllGlobals()
  }
  expect(media.removeEventListener).toHaveBeenCalledTimes(1)
})
