import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Doc } from 'yjs'
import { localDocumentStorage } from '#/lib/documents/storages/local'
import { workspaceDocumentStorage } from '#/lib/documents/workspace-storage'
import { NewDocument } from './NewDocument'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const container = document.createElement('div')
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  navigate.mockReset()
})

it('creates one persistent document and opens its stable route under StrictMode', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <StrictMode>
        <NewDocument />
      </StrictMode>,
    ),
  )
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
  const [saved] = await localDocumentStorage.list()
  expect(saved).toBeDefined()
  expect(navigate).toHaveBeenCalledWith({
    to: '/d/$id',
    params: { id: saved.id },
    replace: true,
  })
  const original = new Doc()
  const session = localDocumentStorage.open(saved.id, original)
  await session.whenSynced
  original.getText('content').insert(0, 'Writing survives reload')
  await session.destroy()
  original.destroy()
  const reopened = new Doc()
  const reopenedSession = localDocumentStorage.open(saved.id, reopened)
  await reopenedSession.whenSynced
  expect(reopened.getText('content').toString()).toBe('Writing survives reload')
  await reopenedSession.destroy()
  reopened.destroy()
})

it('offers retry when creation fails', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(workspaceDocumentStorage, 'create').mockRejectedValueOnce(
    new Error('Unavailable'),
  )
  root = createRoot(container)
  await act(async () => root.render(<NewDocument />))
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  )
  await act(async () => container.querySelector('button')!.click())
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      to: '/d/$id',
      replace: true,
    }),
  )
})
