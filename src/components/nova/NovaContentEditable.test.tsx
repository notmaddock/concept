import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NovaContentEditable } from './NovaContentEditable'

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

it('renders placeholder with logical insetInlineStart styling for bidirectional text', async () => {
  const initialConfig = {
    namespace: 'test-content-editable',
    onError: (error: Error) => {
      throw error
    },
  }

  await act(() => {
    root.render(
      <LexicalComposer initialConfig={initialConfig}>
        <NovaContentEditable />
      </LexicalComposer>,
    )
  })

  const placeholder = container.querySelector<HTMLSpanElement>(
    'span.pointer-events-none',
  )
  expect(placeholder).not.toBeNull()
  expect(placeholder?.textContent).toContain("Begin typing or use '/'")
  expect(placeholder?.style.insetInlineStart).toContain(
    'var(--page-margin-left',
  )
})
