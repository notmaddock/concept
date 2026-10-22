import { renderToString } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DocumentList } from './DocumentList'

it('renders stable, accessible placeholders before hydration', () => {
  const render = () =>
    renderToString(
      <DocumentList
        documents={[]}
        loading
        loadingLabel="Searching documents…"
        onDelete={vi.fn()}
      />,
    )
  const markup = render()
  expect(render()).toBe(markup)
  const container = document.createElement('div')
  container.innerHTML = markup
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    'Searching documents…',
  )
  expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(5)
  expect(container.querySelector('a, button')).toBeNull()
})

it('shows an empty search result only after loading completes', () => {
  const props = {
    documents: [],
    emptyMessage: 'No matching documents',
    onDelete: vi.fn(),
  }
  expect(renderToString(<DocumentList {...props} loading />)).not.toContain(
    props.emptyMessage,
  )
  const markup = renderToString(<DocumentList {...props} />)
  expect(markup).toContain(props.emptyMessage)
  expect(markup).toContain('aria-busy="false"')
  expect(markup).not.toContain('data-slot="skeleton"')
})
