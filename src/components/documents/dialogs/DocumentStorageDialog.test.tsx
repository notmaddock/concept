import { waitForAct } from '#/test/wait-for-act'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Doc, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type * as ConceptFileModule from '#/lib/documents/concept-file'
import type { Root } from 'react-dom/client'
import { DocumentStorageDialog } from './DocumentStorageDialog'
import { storageLocations } from '#/lib/documents/storage-locations'
import { serializeConcept } from '#/lib/documents/concept-file'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), importConcept: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('#/lib/documents/concept-file', async (original) => ({
  ...(await original<typeof ConceptFileModule>()),
  importConcept: mocks.importConcept,
}))

let root: Root
let container: HTMLDivElement
let doc: Doc
const onClose = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.importConcept.mockResolvedValue({ id: 'imported' })
  mocks.navigate.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  doc = new Doc()
  doc.get('root', XmlText).insert(0, 'Document content')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  doc.destroy()
})

async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) =>
      item.textContent === label || item.textContent.trim().startsWith(label),
  )
  expect(button).toBeDefined()
  await act(async () => {
    button?.click()
  })
}

it('requires device selection and confirmation showing file size and origin before opening', async () => {
  await act(async () =>
    root.render(<DocumentStorageDialog mode="open" onClose={onClose} />),
  )
  expect(document.querySelector('input[type="file"]')).toBeNull()
  await click('This device')
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input.hidden).toBe(true)
  const openChooser = vi.spyOn(input, 'click')
  await click('Browse files')
  expect(openChooser).toHaveBeenCalledOnce()
  openChooser.mockRestore()
  const text = serializeConcept('My document', doc)
  Object.defineProperty(input, 'files', {
    value: [
      {
        name: 'example.concept',
        size: 1234,
        text: () => Promise.resolve(text),
      },
    ],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
  expect(document.body.textContent).toContain('1,234 bytes')
  expect(document.body.textContent).toContain('OriginThis device')
  expect(document.body.textContent).toContain('Save to')
  expect(mocks.importConcept).not.toHaveBeenCalled()
  await click('Open document')
  expect(mocks.importConcept).toHaveBeenCalledOnce()
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/',
    hash: 'Limported',
  })
  expect(onClose).toHaveBeenCalledOnce()
})

it('uses the same provider selection to save an independently named copy', async () => {
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="copy"
        source={{ name: 'Original', doc }}
        onClose={onClose}
      />,
    ),
  )
  expect(document.querySelector('input')?.value).toBe('Copy of Original')
  await click('Save copy')
  expect(mocks.importConcept).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Original', format: 'concept' }),
    'Copy of Original',
  )
  expect(onClose).toHaveBeenCalledOnce()
})

it('keeps invalid files out of storage and displays the error', async () => {
  await act(async () =>
    root.render(<DocumentStorageDialog mode="open" onClose={onClose} />),
  )
  await click('This device')
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', {
    value: [
      { name: 'broken.concept', size: 3, text: () => Promise.resolve('bad') },
    ],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('not a supported .concept document'),
  )
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === 'Open document',
    ),
  ).toBe(false)
  expect(mocks.importConcept).not.toHaveBeenCalled()
})

it('opens a library document in place without saving a duplicate', async () => {
  const file = JSON.parse(
    serializeConcept('Existing', doc),
  ) as ConceptFileModule.ConceptFile
  const read = vi.fn().mockResolvedValue({
    file,
    size: 100,
    filename: 'Existing',
    origin: 'Local library',
    existingId: 'existing-id',
  })
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="open"
        onClose={onClose}
        sources={[
          {
            id: 'library',
            icon: storageLocations.local.icon,
            label: 'Test library',
            description: 'Saved documents',
            kind: 'library',
            list: async () => [
              { id: 'existing-id', name: 'Existing', updatedAt: 0 },
            ],
            read,
          },
        ]}
      />,
    ),
  )
  await click('Test library')
  await click('Existing')
  expect(document.body.textContent).not.toContain('Save to')
  expect(document.body.textContent).toContain('Opens the existing document')
  await click('Open document')
  expect(mocks.importConcept).not.toHaveBeenCalled()
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/',
    hash: 'Lexisting-id',
  })
})

it('saves an imported document to the selected provider independently of its source', async () => {
  const saveLocal = vi.fn().mockResolvedValue({ id: 'local-copy' })
  const saveOther = vi.fn().mockResolvedValue({ id: 'other-copy' })
  const file = JSON.parse(
    serializeConcept('External document', doc),
  ) as ConceptFileModule.ConceptFile
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="open"
        onClose={onClose}
        sources={[
          {
            id: 'external',
            icon: storageLocations.local.icon,
            label: 'External source',
            description: 'Another source',
            kind: 'library',
            list: async () => [
              { id: 'external-file', name: 'External document', updatedAt: 0 },
            ],
            read: async () => ({
              file,
              size: 100,
              filename: 'External.concept',
              origin: 'External source',
            }),
          },
        ]}
        providers={[
          {
            id: 'local',
            icon: storageLocations.local.icon,
            label: 'Local library',
            description: 'This browser',
            save: saveLocal,
          },
          {
            id: 'other',
            icon: storageLocations.device.icon,
            label: 'Other provider',
            description: 'Another destination',
            save: saveOther,
          },
        ]}
      />,
    ),
  )
  await click('External source')
  await click('External document')
  const confirm = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Open document',
  )!
  expect(confirm.disabled).toBe(true)
  await click('Other provider')
  await click('Open document')
  expect(saveOther).toHaveBeenCalledWith(file, 'External document')
  expect(saveLocal).not.toHaveBeenCalled()
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/',
    hash: 'Lother-copy',
  })
})

it('converts an import before saving and reuses destination selection', async () => {
  const save = vi.fn().mockResolvedValue({ id: 'destination' })
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="import"
        importFormat="markdown"
        onClose={onClose}
        providers={[
          { ...storageLocations.local, save: vi.fn() },
          { ...storageLocations.device, save },
        ]}
      />,
    ),
  )
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input.accept).toContain('.md')
  Object.defineProperty(input, 'files', {
    value: [{ name: 'Imported.md', size: 12, text: async () => '# Imported' }],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await waitForAct(
    async () => {
      expect(document.body.textContent).toContain('Save to')
    },
    { timeout: 5000 },
  )
  expect(save).not.toHaveBeenCalled()
  expect(mocks.importConcept).not.toHaveBeenCalled()
  expect(
    document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value,
  ).toBe('Imported')
  await click('This device')
  await click('Import document')
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Imported', format: 'concept' }),
    'Imported',
  )
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/',
    hash: 'Ldestination',
  })
  expect(onClose).toHaveBeenCalledOnce()
})

it('reports library listing failures via toast and suppresses the empty message', async () => {
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="open"
        onClose={onClose}
        sources={[
          {
            id: 'failing-library',
            icon: storageLocations.local.icon,
            label: 'Failing library',
            description: 'Broken source',
            kind: 'library',
            list: () => Promise.reject(new Error('Network down')),
            read: vi.fn(),
          },
        ]}
      />,
    ),
  )
  await click('Failing library')
  expect(toast.error).toHaveBeenCalledWith(
    'Could not load documents. Choose the source again to retry.',
  )
  expect(document.body.textContent).not.toContain('No documents saved here yet')
})

it('reports save failures via toast without closing the dialog', async () => {
  mocks.importConcept.mockRejectedValueOnce(new Error('Disk quota exceeded.'))
  await act(async () =>
    root.render(
      <DocumentStorageDialog
        mode="copy"
        source={{ name: 'Original', doc }}
        onClose={onClose}
      />,
    ),
  )
  await click('Save copy')
  expect(toast.error).toHaveBeenCalledWith('Disk quota exceeded.')
  expect(onClose).not.toHaveBeenCalled()
})
