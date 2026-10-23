import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewDocument } from '#/components/documents/NewDocument'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'
import { Route as AuthRoute } from '#/routes/api/auth/$'
import { Route as DocumentIdRoute } from '#/routes/d/$id'
import { Route as DocumentIndexRoute } from '#/routes/d/index'
import { Route as NewDocumentRoute } from '#/routes/new/index'

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  workspaceProps: vi.fn(),
}))

vi.mock('#/lib/auth/server', () => ({
  getAuth: () => ({
    handler: mocks.authHandler,
  }),
}))

vi.mock('#/components/documents/DocumentWorkspace', () => ({
  DocumentWorkspace: (props: { id?: string }) => {
    mocks.workspaceProps(props)
    return <div data-testid="route-workspace" data-id={props.id ?? ''} />
  },
}))

vi.mock('#/components/documents/NewDocument', () => ({
  NewDocument: () => <div data-testid="route-new-document" />,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
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

describe('peripheral route definitions', () => {
  it('forwards GET and POST requests on /api/auth/$ to Better Auth handler', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 })
    mocks.authHandler.mockResolvedValue(response)

    const handlers = AuthRoute.options.server?.handlers as {
      GET: (ctx: { request: Request }) => Promise<Response>
      POST: (ctx: { request: Request }) => Promise<Response>
    }
    expect(handlers.GET).toBeTypeOf('function')
    expect(handlers.POST).toBeTypeOf('function')

    const getReq = new Request('https://example.com/api/auth/session', {
      method: 'GET',
    })
    const postReq = new Request('https://example.com/api/auth/sign-out', {
      method: 'POST',
    })

    await expect(handlers.GET({ request: getReq })).resolves.toBe(response)
    await expect(handlers.POST({ request: postReq })).resolves.toBe(response)
    expect(mocks.authHandler).toHaveBeenCalledWith(getReq)
    expect(mocks.authHandler).toHaveBeenCalledWith(postReq)
  })

  it('wires /d/ and /new/ routes to DocumentWorkspace and NewDocument components', () => {
    expect(DocumentIndexRoute.options.component).toBe(DocumentWorkspace)
    expect(NewDocumentRoute.options.component).toBe(NewDocument)
  })

  it('passes the route $id param into DocumentWorkspace on /d/$id', async () => {
    vi.spyOn(DocumentIdRoute, 'useParams').mockReturnValue({
      id: 'doc-route-42',
    })
    const Component = DocumentIdRoute.options.component!

    await act(async () => {
      root.render(<Component />)
    })

    expect(mocks.workspaceProps).toHaveBeenCalledWith({ id: 'doc-route-42' })
    expect(
      container
        .querySelector('[data-testid="route-workspace"]')
        ?.getAttribute('data-id'),
    ).toBe('doc-route-42')
  })
})
