import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type * as RouterModule from '@tanstack/react-router'

import { Route } from './index'

vi.mock('#/components/account/AccountManager', () => ({
  AccountManager: () => <div data-testid="account-manager" />,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof RouterModule>()
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...props
    }: {
      to: string
      children?: ReactNode
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

const container = document.createElement('div')
let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root.unmount())
})

it('links the New document CTA to /new inside a scrollable min-h-svh layout', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const HomeComponent = Route.options.component!
  root = createRoot(container)
  await act(async () => {
    root.render(<HomeComponent />)
  })

  const main = container.querySelector('main')
  expect(main).not.toBeNull()
  expect(main!.className).toContain('min-h-svh')
  expect(main!.className).not.toContain('fixed')

  const link = container.querySelector('a')
  expect(link).not.toBeNull()
  expect(link!.getAttribute('href')).toBe('/new')
  expect(link!.textContent).toContain('New document')
})
