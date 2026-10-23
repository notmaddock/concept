import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { expect, it, vi } from 'vitest'
import { FloatingTextFormatToolbarPlugin } from './FloatingTextFormatToolbarPlugin'

let editor: ReturnType<typeof createEditor>

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [editor],
}))
vi.mock('./FloatingTextFormatToolbar', () => ({
  FloatingTextFormatToolbar: () => null,
}))

it('schedules updates after effect cleanup cancels a pending frame', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const requestFrame = vi.fn(() => 1)
  const cancelFrame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  editor = createEditor()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const registerRoot = editor.registerRootListener.bind(editor)
  vi.spyOn(editor, 'registerRootListener').mockImplementation((listener) => {
    // Root setup can trigger a selection event before StrictMode replays effects.
    document.dispatchEvent(new Event('selectionchange'))
    return registerRoot(listener)
  })
  try {
    await act(() =>
      root.render(
        <StrictMode>
          <FloatingTextFormatToolbarPlugin />
        </StrictMode>,
      ),
    )
    expect(cancelFrame).toHaveBeenCalledWith(1)
    expect(requestFrame).toHaveBeenCalledTimes(2)
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
