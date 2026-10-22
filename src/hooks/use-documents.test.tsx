import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { DocumentStorage } from '#/lib/documents/storage'
import { useDocuments } from './use-documents'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('#/lib/documents/storage', () => ({ localDocumentStorage: {} }))

let root: Root
let container: HTMLDivElement
let actions: ReturnType<typeof useDocuments>
const first = { id: 'first', name: 'First', updatedAt: 1 }
const second = { id: 'second', name: 'Second', updatedAt: 2 }
let storage: DocumentStorage

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  navigate.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  storage = {
    subscribe: vi.fn().mockReturnValue(() => {}),
    list: vi.fn().mockResolvedValue([first, second]),
    get: vi.fn().mockResolvedValue(first),
    create: vi.fn().mockResolvedValue({
      id: 'new',
      name: 'Untitled document',
      updatedAt: 3,
    }),
    rename: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
  }
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

async function mount(id = 'first') {
  function Harness() {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness />))
}

it('uses one creation action and suppresses duplicate concurrent requests', async () => {
  await mount()
  await act(async () => {
    await Promise.all([actions.createDocument(), actions.createDocument()])
  })
  expect(storage.create).toHaveBeenCalledTimes(1)
  expect(actions.documents[0].id).toBe('new')
  expect(navigate).toHaveBeenCalledWith({ to: '/d/$id', params: { id: 'new' } })
  expect(actions.creating).toBe(false)
})

it('returns to the library when deleting the open document', async () => {
  await mount()
  await act(() => actions.deleteDocument('first'))
  expect(storage.delete).toHaveBeenCalledWith('first')
  expect(actions.documents).toEqual([second])
  expect(navigate).toHaveBeenCalledWith({ to: '/d' })
})

it('keeps the current editor open when deleting another document', async () => {
  await mount()
  await act(() => actions.deleteDocument('second'))
  expect(actions.document).toEqual(first)
  expect(navigate).not.toHaveBeenCalled()
})

it('preserves documents and reports a storage deletion failure', async () => {
  vi.mocked(storage.delete).mockRejectedValue(new Error('Storage unavailable'))
  await mount()
  await act(() => actions.deleteDocument('first'))
  expect(actions.documents).toEqual([first, second])
  expect(actions.error).toContain('Could not delete')
  expect(navigate).not.toHaveBeenCalled()
})

it('updates document titles and closes a remotely deleted document without window focus', async () => {
  await mount()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  const renamed = { ...first, name: 'Renamed in another tab' }
  vi.mocked(storage.list).mockResolvedValue([renamed, second])
  await act(() => listener({ type: 'upsert', document: renamed }))
  expect(actions.document?.name).toBe(renamed.name)
  vi.mocked(storage.list).mockResolvedValue([second])
  await act(() => listener({ type: 'delete', id: first.id }))
  expect(actions.document).toBeUndefined()
  expect(navigate).toHaveBeenCalledWith({ to: '/d' })
})

it('finishes the loading state when the library cannot be read', async () => {
  vi.mocked(storage.list).mockRejectedValue(new Error('Storage unavailable'))
  await mount()
  expect(actions.loaded).toBe(true)
  expect(actions.error).toContain('Could not open local documents')
})
