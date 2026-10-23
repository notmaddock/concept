import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFound } from './not-found'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

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

describe('NotFound', () => {
  it('renders the not-found heading and navigation links to home and new document', async () => {
    await act(async () => {
      root.render(<NotFound />)
    })

    expect(container.querySelector('h1')?.textContent).toBe('Page not found')
    const links = Array.from(container.querySelectorAll('a'))
    expect(
      links.map((a) => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href'),
      })),
    ).toEqual([
      { text: 'Go to home', href: '/' },
      { text: 'New document', href: '/new' },
    ])
  })
})
