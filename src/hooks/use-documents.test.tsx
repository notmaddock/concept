import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { DocumentStorage } from '#/lib/documents/storage'
import { useDocuments } from './use-documents'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

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
  vi.mocked(toast.error).mockClear()
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

async function mount(id: string | undefined = 'first') {
  function Harness() {
    actions = useDocuments(id, storage)
    return null
  }
  await act(async () => {
    root.render(<Harness />)
    await Promise.resolve()
  })
}

it('uses one creation action and suppresses duplicate concurrent requests', async () => {
  await mount()
  await act(async () => {
    await Promise.all([actions.createDocument(), actions.createDocument()])
  })
  expect(storage.create).toHaveBeenCalledTimes(1)
  expect(actions.documents[0].id).toBe('new')
  expect(navigate).toHaveBeenCalledWith({ to: '/', hash: 'Lnew' })
  expect(actions.creating).toBe(false)
})

it('returns to the library when deleting the open document', async () => {
  await mount()
  await act(() => actions.deleteDocument('first'))
  expect(storage.delete).toHaveBeenCalledWith('first')
  expect(actions.documents).toEqual([second])
  expect(navigate).toHaveBeenCalledWith({ to: '/' })
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
  expect(navigate).toHaveBeenCalledWith({ to: '/' })
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
  expect(actions.error).toBe('')
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    'Could not save the document name. Please try again.',
    { id: 'drive-rename:second' },
  )
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
  expect(navigate).toHaveBeenCalledWith({ to: '/' })
})

it('keeps the root as a library without selecting an existing document', async () => {
  function Harness() {
    actions = useDocuments(undefined, storage)
    return null
  }
  await act(() => root.render(<Harness />))
  expect(actions.loaded).toBe(true)
  expect(actions.document).toBeUndefined()
  expect(storage.create).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  await act(() =>
    listener({ type: 'upsert', document: { ...first, updatedAt: 10 } }),
  )
  expect(actions.document).toBeUndefined()
})

it('keeps an empty root library empty until a document is explicitly created', async () => {
  vi.mocked(storage.list).mockResolvedValue([])
  function Harness() {
    actions = useDocuments(undefined, storage)
    return null
  }
  await act(() => root.render(<Harness />))
  expect(actions.loaded).toBe(true)
  expect(actions.document).toBeUndefined()
  expect(storage.create).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  await act(() => actions.createDocument())
  expect(storage.create).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith({ to: '/', hash: 'Lnew' })
})

it('closes the document when navigating back to the root', async () => {
  function Harness({ id }: { id?: string }) {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness id="first" />))
  expect(actions.document).toEqual(first)
  await act(() => root.render(<Harness />))
  expect(actions.document).toBeUndefined()
  expect(actions.loaded).toBe(true)
  expect(storage.create).not.toHaveBeenCalled()
})

it('resolves a direct Drive identity missing from the current library', async () => {
  const drive = {
    id: 'Goutside-page',
    name: 'Direct Drive file',
    updatedAt: 3,
    drive: { fileId: 'outside-page', offlineAvailable: false },
  }
  let resolveLookup!: (value: typeof drive) => void
  vi.mocked(storage.get).mockReturnValue(
    new Promise((resolve) => {
      resolveLookup = resolve
    }),
  )
  await mount(drive.id)
  expect(storage.get).toHaveBeenCalledExactlyOnceWith(drive.id)
  expect(actions.loaded).toBe(false)
  await act(() => resolveLookup(drive))
  expect(actions.document).toEqual(drive)
  expect(actions.loaded).toBe(true)
  expect(storage.create).not.toHaveBeenCalled()
})

it.each([undefined, Object.assign(new Error('Missing'), { status: 404 })])(
  'finishes a missing direct document lookup without creating a replacement',
  async (result) => {
    if (result instanceof Error)
      vi.mocked(storage.get).mockRejectedValue(result)
    else vi.mocked(storage.get).mockResolvedValue(result)
    await mount('Gmissing')
    expect(actions.loaded).toBe(true)
    expect(actions.document).toBeUndefined()
    expect(actions.error).toBe('')
    expect(storage.get).toHaveBeenCalledOnce()
    expect(storage.create).not.toHaveBeenCalled()
  },
)

it('reports a failed direct lookup without retrying in a render loop', async () => {
  vi.mocked(storage.get).mockRejectedValue(new Error('Reconnect Google Drive'))
  await mount('Gdisconnected')
  expect(actions.loaded).toBe(true)
  expect(actions.error).toBe('Reconnect Google Drive')
  expect(storage.get).toHaveBeenCalledOnce()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  await act(() =>
    listener({ type: 'upsert', document: { ...first, id: 'Gdisconnected' } }),
  )
  expect(actions.error).toBe('')
  expect(actions.document?.id).toBe('Gdisconnected')
})

it('ignores a direct lookup that finishes after navigation', async () => {
  let resolveLookup!: (value: typeof first) => void
  vi.mocked(storage.get).mockReturnValue(
    new Promise((resolve) => {
      resolveLookup = resolve
    }),
  )
  function Harness({ id }: { id: string }) {
    actions = useDocuments(id, storage)
    return null
  }
  await act(() => root.render(<Harness id="Gslow" />))
  await act(() => root.render(<Harness id="second" />))
  await act(() => resolveLookup({ ...first, id: 'Gslow' }))
  expect(actions.document).toEqual(second)
  expect(actions.documents.some((item) => item.id === 'Gslow')).toBe(false)
  expect(actions.loaded).toBe(true)
})

it('does not open another document when deleting documents from the root', async () => {
  function Harness() {
    actions = useDocuments(undefined, storage)
    return null
  }
  await act(() => root.render(<Harness />))
  await act(() => actions.deleteDocument(second.id))
  expect(actions.document).toBeUndefined()
  const listener = vi.mocked(storage.subscribe).mock.calls[0][0]
  await act(() => listener({ type: 'delete', id: first.id }))
  expect(actions.document).toBeUndefined()
  expect(storage.create).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})
