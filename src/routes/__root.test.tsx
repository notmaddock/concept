import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type * as RouterModule from '@tanstack/react-router'

import { RouteError } from '#/components/route-error'
import { getRouter } from '#/router'
import { Route as RootRoute } from './__root'
import { Route as DocumentsRoute } from './d/index'
import { Route as NewDocumentRoute } from './new/index'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof RouterModule>()
  return {
    ...actual,
    useRouter: () => ({ invalidate }),
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

it('defines root SEO metadata and per-route head titles', async () => {
  const rootHead = await RootRoute.options.head?.({} as never)
  expect(rootHead?.meta).toEqual(
    expect.arrayContaining([
      { title: 'Concept' },
      expect.objectContaining({ name: 'description' }),
      expect.objectContaining({ property: 'og:title', content: 'Concept' }),
      expect.objectContaining({ property: 'og:description' }),
      expect.objectContaining({ name: 'twitter:card', content: 'summary' }),
    ]),
  )

  const documentsHead = await DocumentsRoute.options.head?.({} as never)
  expect(documentsHead?.meta).toEqual([{ title: 'Documents — Concept' }])

  const newDocHead = await NewDocumentRoute.options.head?.({} as never)
  expect(newDocHead?.meta).toEqual([{ title: 'New document — Concept' }])
})

it('configures the user-facing RouteError fallback', async () => {
  const router = getRouter()
  expect(router.options.defaultPreloadStaleTime).toBe(0)
  expect(router.options.defaultErrorComponent).toBe(RouteError)
  expect(RootRoute.options.errorComponent).toBe(RouteError)

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const reset = vi.fn()

  await act(async () => {
    root.render(
      <RouteError error={new Error('Internal stack')} reset={reset} />,
    )
  })

  expect(container.textContent).toContain('Something went wrong')
  expect(container.textContent).not.toContain('Internal stack')

  const tryAgain = container.querySelector('button')
  expect(tryAgain).not.toBeNull()
  await act(async () => {
    tryAgain!.click()
  })
  expect(reset).toHaveBeenCalledOnce()
  expect(invalidate).toHaveBeenCalledOnce()

  await act(async () => {
    root.unmount()
  })
})
