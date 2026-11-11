import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChangelogDialog } from './ChangelogDialog'

vi.mock('virtual:changelog', () => ({
  default: [
    {
      version: '0.1.0',
      date: '2026-11-10',
      sections: [
        {
          title: 'Features',
          items: [
            [
              { type: 'text', value: 'Add ' },
              {
                type: 'strong',
                children: [{ type: 'text', value: 'pagination' }],
              },
              { type: 'text', value: ' and ' },
              {
                type: 'link',
                href: 'https://example.com/release',
                children: [{ type: 'text', value: 'release notes' }],
              },
            ],
          ],
        },
      ],
    },
  ],
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

it('renders release notes with inline formatting and links', async () => {
  await act(() => root.render(<ChangelogDialog open onOpenChange={() => {}} />))

  expect(document.body.textContent).toContain("What's new")
  expect(document.body.textContent).toContain('v0.1.0')
  expect(document.body.textContent).toContain('Features')
  expect(document.body.textContent).toContain('pagination')
  expect(document.querySelector('a')?.getAttribute('href')).toBe(
    'https://example.com/release',
  )
})
