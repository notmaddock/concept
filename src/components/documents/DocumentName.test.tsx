import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { DocumentName } from './DocumentName'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

it.each([
  ['', false, 'Original'],
  ['   ', false, 'Original'],
  ['  Original  ', true, 'Original'],
  ['Rejected', false, 'Original'],
  ['  Updated  ', true, 'Updated'],
] as const)(
  'reconciles the draft %j after save',
  async (draft, saved, expected) => {
    const onSave = vi.fn().mockResolvedValue(saved)
    await act(() =>
      root.render(<DocumentName name="Original" onSave={onSave} />),
    )
    const input = container.querySelector('input')!
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, draft)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(() =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    )
    expect(onSave).toHaveBeenCalledWith(draft)
    expect(input.value).toBe(expected)
  },
)

it('restores the persisted name on Escape', async () => {
  const onSave = vi.fn().mockResolvedValue(true)
  await act(() => root.render(<DocumentName name="Original" onSave={onSave} />))
  const input = container.querySelector('input')!
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Draft')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
  })
  expect(input.value).toBe('Original')
  expect(onSave).not.toHaveBeenCalled()
})
