import { afterEach, vi } from 'vitest'
import { TestBroadcastChannel } from './broadcast-channel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  }
}

if (
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard === 'undefined'
) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: {
      readText: async () => '',
      read: async () => [],
      writeText: async () => {},
      write: async () => {},
    },
  })
}

if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:mock',
    })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => {},
    })
  }
}

afterEach(() => {
  TestBroadcastChannel.reset()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
