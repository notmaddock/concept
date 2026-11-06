import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { DocumentAccessStatus } from './DocumentAccessStatus'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('keeps unverified access visible independently of local edit permission', async () => {
  await act(async () =>
    root.render(
      <DocumentAccessStatus
        readOnly={false}
        provider="google-drive"
        access={{ kind: 'unverified', previous: 'editor', reason: 'offline' }}
      />,
    ),
  )
  const button = container.querySelector('button')!
  expect(button.textContent).toBe('Access unverified')
  expect(button.className).toContain('text-orange-600')
  await act(async () => button.click())
  expect(document.body.textContent).toContain(
    'Available offline work is preserved locally.',
  )
})

it('announces confirmed unavailability as a persistent access status', async () => {
  await act(async () =>
    root.render(
      <DocumentAccessStatus
        readOnly
        provider="google-drive"
        access={{ kind: 'unavailable', checkedAt: Date.now() }}
      />,
    ),
  )
  const button = container.querySelector('button')!
  expect(button.getAttribute('aria-label')).toBe(
    'Document permissions: Access unavailable',
  )
  expect(button.className).toContain('text-red-600')
})
