import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RenameDocumentDialog } from './RenameDocumentDialog'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

function setInputValue(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('RenameDocumentDialog', () => {
  it('trims the document name, calls onRename on submit, and closes when successful', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <RenameDocumentDialog
          name="Initial Name"
          onRename={onRename}
          onClose={onClose}
        />,
      )
    })

    const input = document.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Initial Name')

    await act(async () => {
      setInputValue(input, '   ')
    })

    const saveBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Save',
    )!
    expect(saveBtn.disabled).toBe(true)

    await act(async () => {
      setInputValue(input, '  Updated Title  ')
    })
    expect(saveBtn.disabled).toBe(false)

    await act(async () => {
      saveBtn.click()
    })

    expect(onRename).toHaveBeenCalledWith('Updated Title')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('displays an alert when onRename returns false or throws and allows cancelling', async () => {
    const onRename = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('Storage failure'))
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <RenameDocumentDialog
          name="Draft"
          onRename={onRename}
          onClose={onClose}
        />,
      )
    })

    const form = document.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not rename the document. Please try again.',
    )
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not rename the document. Please try again.',
    )

    const cancelBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Cancel',
    )!
    await act(async () => {
      cancelBtn.click()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
