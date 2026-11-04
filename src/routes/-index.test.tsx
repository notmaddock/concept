import { act, useEffect } from 'react'
import type { ComponentType } from 'react'
import type * as TanStackRouter from '@tanstack/react-router'
import { hydrateRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Route } from './index'

const state = vi.hoisted(() => ({
  hash: '',
  workspaceRenders: [] as Array<string | undefined>,
  workspaceEffects: [] as Array<string | undefined>,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof TanStackRouter>()),
  useLocation: ({
    select,
  }: {
    select: (location: { hash: string }) => unknown
  }) => select({ hash: state.hash }),
}))

vi.mock('#/components/documents/DocumentWorkspace', () => ({
  DocumentWorkspace: ({ id }: { id?: string }) => {
    state.workspaceRenders.push(id)
    useEffect(() => {
      state.workspaceEffects.push(id)
    }, [id])
    return (
      <div data-document-id={id}>
        {id ? 'Opening document…' : 'Loading documents…'}
      </div>
    )
  },
}))

const DocumentRoute = Route.options.component as ComponentType
let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.hash = ''
  state.workspaceRenders = []
  state.workspaceEffects = []
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(() => root?.unmount())
  root = undefined
  container.remove()
})

it.each([
  ['Gdrive-file-id', 'Gdrive-file-id'],
  ['Llocal-document-id', 'local-document-id'],
])(
  'hydrates the hash URL #%s without a mismatched or default workspace',
  async (hash, id) => {
    const html = renderToString(<DocumentRoute />)
    expect(html).toContain('Loading documents…')
    expect(state.workspaceRenders).toEqual([])
    container.innerHTML = html
    state.hash = hash
    const hydrationError = vi.fn()
    await act(() => {
      root = hydrateRoot(container, <DocumentRoute />, {
        onRecoverableError: hydrationError,
      })
    })
    expect(hydrationError).not.toHaveBeenCalled()
    expect(
      container
        .querySelector('[data-document-id]')
        ?.getAttribute('data-document-id'),
    ).toBe(id)
    expect(state.workspaceRenders.length).toBeGreaterThan(0)
    expect(state.workspaceRenders.every((rendered) => rendered === id)).toBe(
      true,
    )
    expect(state.workspaceEffects).toEqual([id])
  },
)

it('mounts the default workspace only after hydration when no document hash exists', async () => {
  container.innerHTML = renderToString(<DocumentRoute />)
  expect(state.workspaceRenders).toEqual([])
  await act(() => {
    root = hydrateRoot(container, <DocumentRoute />)
  })
  expect(state.workspaceEffects).toEqual([undefined])
})
