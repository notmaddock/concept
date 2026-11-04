import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CanaryWarningDialog,
  CANARY_WARNING_STORAGE_KEY,
} from './canary-warning-dialog'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

describe('CanaryWarningDialog', () => {
  it('shows welcoming pre-alpha warning dialog when not yet acknowledged', async () => {
    await act(async () => {
      root.render(<CanaryWarningDialog />)
    })

    expect(document.body.textContent).toContain('Welcome to Concept!')
    expect(document.body.textContent).toContain(
      'Concept is in very early development and is in pre-alpha',
    )
    expect(document.body.textContent).toContain(
      'until 1.0 your documents might break',
    )
    expect(document.body.textContent).toContain(
      'I acknowledge Concept is in very early development and I might lose my documents',
    )
  })

  it('keeps Acknowledge button disabled until checkbox is checked', async () => {
    await act(async () => {
      root.render(<CanaryWarningDialog />)
    })

    const acknowledgeButton = Array.from(
      document.querySelectorAll('button'),
    ).find((btn) => btn.textContent.trim() === 'Acknowledge')

    expect(acknowledgeButton).toBeDefined()
    expect(acknowledgeButton?.disabled).toBe(true)

    const checkbox = document.querySelector(
      '#canary-acknowledge-checkbox',
    ) as HTMLInputElement
    expect(checkbox).not.toBeNull()

    // Tick the checkbox
    await act(async () => {
      checkbox.click()
    })

    expect(acknowledgeButton?.disabled).toBe(false)

    // Untick the checkbox
    await act(async () => {
      checkbox.click()
    })

    expect(acknowledgeButton?.disabled).toBe(true)
  })

  it('saves acknowledgement to localStorage and closes when Acknowledge is clicked', async () => {
    await act(async () => {
      root.render(<CanaryWarningDialog />)
    })

    const checkbox = document.querySelector(
      '#canary-acknowledge-checkbox',
    ) as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })

    const acknowledgeButton = Array.from(
      document.querySelectorAll('button'),
    ).find((btn) => btn.textContent.trim() === 'Acknowledge')

    await act(async () => {
      acknowledgeButton?.click()
    })

    expect(localStorage.getItem(CANARY_WARNING_STORAGE_KEY)).toBe('true')
    expect(
      document.querySelector('[data-slot="alert-dialog-content"]'),
    ).toBeNull()
  })

  it('does not open if already acknowledged in localStorage', async () => {
    localStorage.setItem(CANARY_WARNING_STORAGE_KEY, 'true')

    await act(async () => {
      root.render(<CanaryWarningDialog />)
    })

    expect(document.body.textContent).not.toContain('Welcome to Concept!')
  })
})
