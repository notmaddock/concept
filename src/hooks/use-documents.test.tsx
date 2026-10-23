import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { DocumentStorage } from '#/lib/documents/storage'
import { useDocuments } from './use-documents'
import { workspaceDocumentStorage } from '#/lib/documents/workspace-storage'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

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
  document.body.appendChild(container)
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
  vi.restoreAllMocks()
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

it('does not navigate away when switching to another document while deleting the previous one', async () => {
  let resolveDelete!: () => void
  vi.mocked(storage.delete).mockReturnValue(
    new Promise((resolve) => {
      resolveDelete = resolve
    }),
  )
  function Harness({ id }: { id: string }) {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness id="first" />))
  const deletion = actions.deleteDocument('first')
  await act(() => root.render(<Harness id="second" />))
  await act(async () => {
    resolveDelete()
    await deletion
  })
  expect(actions.documents).toEqual([second])
  expect(actions.document).toEqual(second)
  expect(navigate).not.toHaveBeenCalled()
})

it('returns to the library when navigating into a document whose deletion is in flight', async () => {
  let resolveDelete!: () => void
  vi.mocked(storage.delete).mockReturnValue(
    new Promise((resolve) => {
      resolveDelete = resolve
    }),
  )
  function Harness({ id }: { id: string }) {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness id="first" />))
  const deletion = actions.deleteDocument('second')
  await act(() => root.render(<Harness id="second" />))
  await act(async () => {
    resolveDelete()
    await deletion
  })
  expect(actions.documents).toEqual([first])
  expect(navigate).toHaveBeenCalledWith({ to: '/d' })
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

it('renames a sidebar document without changing the open document', async () => {
  const renamed = { ...second, name: 'New name' }
  vi.mocked(storage.rename).mockResolvedValue(renamed)
  await mount()
  await act(async () => {
    expect(await actions.renameDocumentById('second', '  New name  ')).toBe(
      true,
    )
  })
  expect(storage.rename).toHaveBeenCalledWith('second', 'New name')
  expect(actions.documents).toEqual([first, renamed])
  expect(actions.document).toEqual(first)
  expect(navigate).not.toHaveBeenCalled()
})

it('rejects blank names and reports failed renames without changing documents', async () => {
  await mount()
  expect(await actions.renameDocumentById('second', '  ')).toBe(false)
  expect(storage.rename).not.toHaveBeenCalled()
  vi.mocked(storage.rename).mockRejectedValue(new Error('Storage unavailable'))
  await act(async () => {
    expect(await actions.renameDocumentById('second', 'New name')).toBe(false)
  })
  expect(actions.documents).toEqual([first, second])
  expect(actions.error).toContain('Could not save the document name')
})

it('uses change payloads without rereading the library', async () => {
  await mount()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  await act(() => {
    listener({ type: 'upsert', document: { ...first, name: 'Updated' } })
    listener({ type: 'delete', id: second.id })
  })
  expect(storage.list).toHaveBeenCalledTimes(1)
  expect(actions.documents).toEqual([{ ...first, name: 'Updated' }])
})

it('preserves changes received while a library reconciliation is in flight', async () => {
  let resolveRead!: (items: (typeof first)[]) => void
  vi.mocked(storage.list).mockReturnValue(
    new Promise((resolve) => {
      resolveRead = resolve
    }),
  )
  await mount()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  const renamed = { ...first, name: 'Changed during read' }
  await act(() => {
    listener({ type: 'upsert', document: renamed })
    listener({ type: 'delete', id: second.id })
    window.dispatchEvent(new Event('focus'))
    resolveRead([first, second])
  })
  expect(actions.documents).toEqual([renamed])
  expect(actions.loaded).toBe(true)
  expect(storage.list).toHaveBeenCalledTimes(1)
})

it('retains its library subscription across document navigation', async () => {
  function Harness({ id }: { id: string }) {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness id="first" />))
  await act(() => root.render(<Harness id="second" />))
  expect(storage.subscribe).toHaveBeenCalledTimes(1)
  expect(storage.list).toHaveBeenCalledTimes(1)
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  await act(() => listener({ type: 'delete', id: second.id }))
  expect(navigate).toHaveBeenCalledWith({ to: '/d' })
})

it.each(['first', undefined])(
  'routes inactive renames through workspace storage from %s',
  async (active) => {
    const renamed = {
      ...second,
      name: 'Cloud rename',
      backing: {
        provider: 'google-drive' as const,
        fileId: 'drive-file',
        accountId: 'account',
      },
    }
    vi.spyOn(workspaceDocumentStorage, 'subscribe').mockImplementation(
      storage.subscribe,
    )
    vi.spyOn(workspaceDocumentStorage, 'list').mockImplementation(storage.list)
    const rename = vi
      .spyOn(workspaceDocumentStorage, 'rename')
      .mockResolvedValue(renamed)
    function Harness() {
      actions = useDocuments(active)
      return null
    }
    await act(() => root.render(<Harness />))
    await act(async () => {
      expect(await actions.renameDocumentById('second', renamed.name)).toBe(
        true,
      )
    })
    expect(rename).toHaveBeenCalledWith('second', renamed.name)
    expect(actions.documents.find((item) => item.id === 'second')?.name).toBe(
      renamed.name,
    )
    expect(navigate).not.toHaveBeenCalled()
  },
)

it('sorts newly created document by updatedAt order', async () => {
  vi.mocked(storage.create).mockResolvedValueOnce({
    id: 'older-created',
    name: 'Older',
    updatedAt: 0,
  })
  await mount()
  await act(async () => {
    await actions.createDocument()
  })
  expect(actions.documents.map((d) => d.id)).toEqual([
    'second',
    'first',
    'older-created',
  ])
})
