import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentFilePicker } from './DocumentFilePicker'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DocumentFilePicker', () => {
  it('opens the hidden file input on button click and invokes onSelect when a file is chosen', async () => {
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        <DocumentFilePicker
          label="Select Concept file"
          accept=".concept"
          description="Pick a .concept archive from your device."
          reading={false}
          status="Reading file…"
          onSelect={onSelect}
        />,
      )
    })

    expect(container.textContent).toContain(
      'Pick a .concept archive from your device.',
    )
    expect(container.querySelector('[role="status"]')).toBeNull()

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input.hidden).toBe(true)
    expect(input.accept).toBe('.concept')
    expect(input.getAttribute('aria-label')).toBe('Select Concept file')

    const clickSpy = vi.spyOn(input, 'click')
    const browseBtn = container.querySelector('button')!
    await act(async () => {
      browseBtn.click()
    })
    expect(clickSpy).toHaveBeenCalledOnce()

    const file = new File(['content'], 'demo.concept', {
      type: 'application/json',
    })
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith(file)
  })

  it('disables controls and renders status text while reading is true', async () => {
    await act(async () => {
      root.render(
        <DocumentFilePicker
          label="Select Concept file"
          accept=".concept"
          description="Pick a file"
          reading={true}
          status="Importing markdown…"
          onSelect={vi.fn()}
        />,
      )
    })

    const browseBtn = container.querySelector('button')!
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(browseBtn.disabled).toBe(true)
    expect(input.disabled).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Importing markdown…',
    )
  })
})
