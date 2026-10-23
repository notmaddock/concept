import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFormatActions } from './use-format-actions'
import type { FormatAction } from './format-options'

const emptyEditorRef: { current: null } = { current: null }
const emptyActions: FormatAction[] = []

describe('useFormatActions polling bounds', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('bounds requestAnimationFrame polling to 60 retries when editorRef is null', async () => {
    const callbacks: FrameRequestCallback[] = []
    const requestSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })

    function Harness() {
      useFormatActions(emptyEditorRef, 'doc', emptyActions, true)
      return null
    }

    await act(() => root.render(<Harness />))

    expect(requestSpy).toHaveBeenCalledTimes(1)

    // Trigger consecutive frames synchronously
    while (callbacks.length > 0) {
      const cb = callbacks.shift()
      cb?.(performance.now())
    }

    // Should stop polling after 60 retries
    expect(requestSpy).toHaveBeenCalledTimes(60)
  })
})
