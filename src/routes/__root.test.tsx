import { expect, it } from 'vitest'
import { Route as RootRoute } from './__root'
import { Route as DocumentsRoute } from './d/index'
import { Route as NewDocumentRoute } from './new/index'

it('defines root SEO metadata and per-route head titles', () => {
  const rootHead = RootRoute.options.head?.({} as never)
  expect(rootHead?.meta).toEqual(
    expect.arrayContaining([
      { title: 'Concept' },
      expect.objectContaining({ name: 'description' }),
      expect.objectContaining({ property: 'og:title', content: 'Concept' }),
      expect.objectContaining({ property: 'og:description' }),
      expect.objectContaining({ name: 'twitter:card', content: 'summary' }),
    ]),
  )

  const documentsHead = DocumentsRoute.options.head?.({} as never)
  expect(documentsHead?.meta).toEqual([{ title: 'Documents — Concept' }])

  const newDocHead = NewDocumentRoute.options.head?.({} as never)
  expect(newDocHead?.meta).toEqual([{ title: 'New document — Concept' }])
})
