import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { DocumentShareDialog } from './DocumentShareDialog'

const providers = vi.hoisted(() => [] as Array<{ supportsSharing?: boolean }>)
vi.mock('#/lib/documents/transfer', () => ({
  documentSaveProviders: providers,
}))
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
it.each([0, 1, 2])(
  'offers cloud copying only with share-capable destinations: %i',
  async (count) => {
    providers.splice(
      0,
      providers.length,
      {},
      ...Array.from({ length: count }, () => ({ supportsSharing: true })),
    )
    await act(() =>
      root.render(
        <DocumentShareDialog open onOpenChange={() => {}} onCopy={() => {}} />,
      ),
    )
    expect(
      document.body.textContent.includes('make a copy to a cloud service'),
    ).toBe(count > 0)
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent === 'Make a copy',
      ),
    ).toBe(count > 0)
  },
)
