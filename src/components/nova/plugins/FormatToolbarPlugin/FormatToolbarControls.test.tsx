import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorSelect } from './ColorSelect'
import { TypographyControls } from './TypographyControls'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let editor: ReturnType<typeof createEditor>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  editor = createEditor()
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  container.appendChild(editable)
  editor.setRootElement(editable)

  editor.update(
    () => {
      const p = $createParagraphNode()
      const text = $createTextNode('Sample formatted text')
      p.append(text)
      $getRoot().append(p)
      text.select(0, 6)
    },
    { discrete: true },
  )
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('ColorSelect active listener gating', () => {
  it('does not register update listeners when active=false', async () => {
    const registerSpy = vi.spyOn(editor, 'registerUpdateListener')

    await act(() => {
      root.render(
        <ColorSelect sectionId="text-color" editor={editor} active={false} />,
      )
    })

    expect(registerSpy).not.toHaveBeenCalled()
    registerSpy.mockRestore()
  })

  it('registers update listener when active=true', async () => {
    const registerSpy = vi.spyOn(editor, 'registerUpdateListener')

    await act(() => {
      root.render(
        <ColorSelect sectionId="text-color" editor={editor} active={true} />,
      )
    })

    expect(registerSpy).toHaveBeenCalledTimes(1)
    registerSpy.mockRestore()
  })
})

describe('TypographyControls layout thrashing prevention', () => {
  it('clears state when active but selection is collapsed or empty', async () => {
    editor.update(
      () => {
        // Clear selection
        $getRoot().selectStart()
      },
      { discrete: true },
    )

    await act(() => {
      root.render(
        <TypographyControls
          editor={editor}
          run={vi.fn()}
          checked={vi.fn()}
          active={true}
        />,
      )
    })

    const sizeInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Font size (pt)"]',
    )
    expect(sizeInput?.value).toBe('')
  })
})
