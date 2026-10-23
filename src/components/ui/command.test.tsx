import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Root } from 'react-dom/client'
import { Command, CommandInput } from './command'

let root: Root
let container: HTMLDivElement

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

describe('CommandInput focus ring indicator', () => {
  it('marks input as input-group-control and command-input so input group draws focus ring', async () => {
    await act(() =>
      root.render(
        <Command>
          <CommandInput placeholder="Search..." />
        </Command>,
      ),
    )

    const input = container.querySelector<HTMLInputElement>(
      '[data-slot="command-input"]',
    )!
    expect(input).not.toBeNull()
    expect(input.hasAttribute('data-input-group-control')).toBe(true)

    const inputGroup = container.querySelector<HTMLElement>(
      '[data-slot="input-group"]',
    )!
    expect(inputGroup).not.toBeNull()
    expect(inputGroup.className).toContain(
      'has-[[data-slot=input-group-control]:focus-visible]:border-ring',
    )
    expect(inputGroup.className).toContain(
      'has-[[data-slot=command-input]:focus-visible]:border-ring',
    )
  })
})
