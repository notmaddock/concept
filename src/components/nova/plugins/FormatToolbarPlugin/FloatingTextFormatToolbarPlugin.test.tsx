import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { expect, it, vi } from 'vitest'
import { FloatingTextFormatToolbarPlugin } from './FloatingTextFormatToolbarPlugin'

let editor: ReturnType<typeof createEditor>

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [editor],
}))
vi.mock('./FloatingTextFormatToolbar', () => ({
  FloatingTextFormatToolbar: () => <div data-testid="selection-toolbar" />,
}))

it('schedules updates after effect cleanup cancels a pending frame', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const requestFrame = vi.fn(() => 1)
  const cancelFrame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  editor = createEditor()
  const container = document.createElement('div')
  document.body.append(container)
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

it.each(['dialog', 'alertdialog'])(
  'hides selection formatting when an external %s takes focus',
  async (role) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const container = document.createElement('div')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.tabIndex = 0
    const dialog = document.createElement('div')
    dialog.setAttribute('role', role)
    const button = document.createElement('button')
    button.textContent = 'Connect Google Drive'
    dialog.append(button)
    document.body.append(container, editable, dialog)
    const root = createRoot(container)
    editor = createEditor()
    editor.setRootElement(editable)
    vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 400),
    )
    const originalRect = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = () => new DOMRect(20, 20, 100, 20)
    async function flushFrames() {
      await act(async () => {
        while (frames.length) frames.shift()!(0)
      })
    }
    try {
      await act(async () => {
        root.render(<FloatingTextFormatToolbarPlugin />)
        editable.focus()
        editor.update(
          () => {
            const text = $createTextNode('Selected text')
            $getRoot().append($createParagraphNode().append(text))
            text.select(0, 8)
          },
          { discrete: true },
        )
      })
      const text = editable.querySelector('span')!.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 8)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      await flushFrames()
      expect(
        container.querySelector('[data-testid="selection-toolbar"]'),
      ).not.toBeNull()
      const formattingDialog = document.createElement('div')
      formattingDialog.setAttribute('role', 'dialog')
      formattingDialog.setAttribute('data-format-toolbar', 'true')
      const formattingButton = document.createElement('button')
      formattingDialog.append(formattingButton)
      container.append(formattingDialog)
      await act(async () => formattingButton.focus())
      await flushFrames()
      expect(
        container.querySelector('[data-testid="selection-toolbar"]'),
      ).not.toBeNull()
      await act(async () => button.focus())
      await flushFrames()
      expect(
        container.querySelector('[data-testid="selection-toolbar"]'),
      ).toBeNull()
    } finally {
      await act(async () => {
        root.unmount()
        editor.setRootElement(null)
      })
      Range.prototype.getBoundingClientRect = originalRect
      container.remove()
      editable.remove()
      dialog.remove()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  },
)

it('hides formatting toolbar when selection is scrolled above or below the viewport fold', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('innerWidth', 1000)

  const container = document.createElement('div')
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.tabIndex = 0
  document.body.append(container, editable)
  const root = createRoot(container)
  editor = createEditor()
  editor.setRootElement(editable)

  vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, -500, 400, 2000),
  )
  const originalRect = Range.prototype.getBoundingClientRect
  let currentRangeRect = new DOMRect(20, 100, 100, 20)
  Range.prototype.getBoundingClientRect = () => currentRangeRect

  async function flushFrames() {
    await act(async () => {
      while (frames.length) frames.shift()!(0)
    })
  }

  try {
    await act(async () => {
      root.render(<FloatingTextFormatToolbarPlugin />)
      editable.focus()
      editor.update(
        () => {
          const text = $createTextNode('Selected text')
          $getRoot().append($createParagraphNode().append(text))
          text.select(0, 8)
        },
        { discrete: true },
      )
    })
    const text = editable.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flushFrames()

    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).not.toBeNull()

    currentRangeRect = new DOMRect(20, -50, 100, 20)
    window.dispatchEvent(new Event('scroll'))
    await flushFrames()
    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).toBeNull()

    currentRangeRect = new DOMRect(20, 100, 100, 20)
    window.dispatchEvent(new Event('scroll'))
    await flushFrames()
    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).not.toBeNull()

    currentRangeRect = new DOMRect(20, 820, 100, 20)
    window.dispatchEvent(new Event('scroll'))
    await flushFrames()
    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).toBeNull()
  } finally {
    await act(async () => {
      root.unmount()
      editor.setRootElement(null)
    })
    Range.prototype.getBoundingClientRect = originalRect
    container.remove()
    editable.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('hides formatting toolbar when selection is scrolled outside nearest scroll container fold', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('innerWidth', 1000)

  const container = document.createElement('div')
  const scrollContainer = document.createElement('div')
  scrollContainer.style.overflowY = 'auto'
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.tabIndex = 0
  scrollContainer.append(editable)
  document.body.append(container, scrollContainer)
  const root = createRoot(container)
  editor = createEditor()
  editor.setRootElement(editable)

  vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 100, 400, 300),
  )
  vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 1500),
  )
  const originalRect = Range.prototype.getBoundingClientRect
  let currentRangeRect = new DOMRect(20, 200, 100, 20)
  Range.prototype.getBoundingClientRect = () => currentRangeRect

  async function flushFrames() {
    await act(async () => {
      while (frames.length) frames.shift()!(0)
    })
  }

  try {
    await act(async () => {
      root.render(<FloatingTextFormatToolbarPlugin />)
      editable.focus()
      editor.update(
        () => {
          const text = $createTextNode('Scrollable text')
          $getRoot().append($createParagraphNode().append(text))
          text.select(0, 8)
        },
        { discrete: true },
      )
    })
    const text = editable.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flushFrames()

    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).not.toBeNull()

    currentRangeRect = new DOMRect(20, 60, 100, 20)
    window.dispatchEvent(new Event('scroll'))
    await flushFrames()
    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).toBeNull()

    currentRangeRect = new DOMRect(20, 420, 100, 20)
    window.dispatchEvent(new Event('scroll'))
    await flushFrames()
    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).toBeNull()
  } finally {
    await act(async () => {
      root.unmount()
      editor.setRootElement(null)
    })
    Range.prototype.getBoundingClientRect = originalRect
    container.remove()
    scrollContainer.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('hides formatting toolbar when focusNode is outside rootElement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  const container = document.createElement('div')
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.tabIndex = 0
  const outsideNode = document.createElement('div')
  outsideNode.textContent = 'Outside text'
  document.body.append(container, editable, outsideNode)
  const root = createRoot(container)
  editor = createEditor()
  editor.setRootElement(editable)

  vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 400),
  )
  const originalRect = Range.prototype.getBoundingClientRect
  Range.prototype.getBoundingClientRect = () => new DOMRect(20, 20, 100, 20)

  async function flushFrames() {
    await act(async () => {
      while (frames.length) frames.shift()!(0)
    })
  }

  try {
    await act(async () => {
      root.render(<FloatingTextFormatToolbarPlugin />)
      editable.focus()
      editor.update(
        () => {
          const text = $createTextNode('Inside editor')
          $getRoot().append($createParagraphNode().append(text))
          text.select(0, 5)
        },
        { discrete: true },
      )
    })
    const text = editable.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(outsideNode.firstChild ?? outsideNode, 0)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flushFrames()

    expect(
      container.querySelector('[data-testid="selection-toolbar"]'),
    ).toBeNull()
  } finally {
    await act(async () => {
      root.unmount()
      editor.setRootElement(null)
    })
    Range.prototype.getBoundingClientRect = originalRect
    container.remove()
    editable.remove()
    outsideNode.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
