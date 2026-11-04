import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import type { LexicalEditor } from 'lexical'
import type { Root } from 'react-dom/client'
import type { Doc } from 'yjs'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import type { ComponentProps } from 'react'
import type { Nova } from '#/components/nova/Nova'
import { toast } from 'sonner'
import { localDocumentStorage } from '#/lib/documents/storage'
import {
  importConcept,
  parseConcept,
  serializeConcept,
} from '#/lib/documents/concept-file'
import { DocumentEditor } from './DocumentEditor'
import { DocumentSaveStatus } from './DocumentSaveStatus'

vi.mock('#/components/nova/Nova', () => ({
  Nova: ({ collaboration, editorRef }: ComponentProps<typeof Nova>) => (
    <LexicalComposer
      initialConfig={{
        namespace: 'reopen-test',
        editorState: null,
        onError: (error) => {
          throw error
        },
      }}
    >
      <ContentEditable aria-label="Document content" />
      {editorRef && <EditorRefPlugin editorRef={editorRef} />}
      {collaboration}
    </LexicalComposer>
  ),
}))

let root: Root
let container: HTMLDivElement
const editorRef = createRef<LexicalEditor>()
const documentRef = createRef<Doc>()

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(id: string, expected = '') {
  await act(() =>
    root.render(
      <DocumentEditor
        key={id}
        id={id}
        documentRef={documentRef}
        editorRef={editorRef}
        pageSetupOpen={false}
        onPageSetupOpenChange={() => {}}
      />,
    ),
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(documentRef.current).not.toBeNull()
    expect(
      editorRef.current
        ?.getEditorState()
        .read(() => $getRoot().getTextContent()),
    ).toBe(expected)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
}

it.each(['saved', 'imported'] as const)(
  'restores %s content through the real collaboration binding',
  async (kind) => {
    const original = await localDocumentStorage.create()
    await open(original.id)
    const text = 'Persisted text — café 🌎'
    await act(async () => {
      editorRef.current?.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode(text)))
        },
        { discrete: true },
      )
    })
    const file = parseConcept(
      serializeConcept('Imported document', documentRef.current!),
    )
    await act(() => root.render(null))
    documentRef.current = null
    const id =
      kind === 'imported' ? (await importConcept(file)).id : original.id
    await open(id, text)
  },
)

it('replaces the loading state with an empty error state and toast when stored content cannot be opened', async () => {
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
  await act(() =>
    root.render(
      <DocumentEditor
        id="missing"
        documentRef={documentRef}
        editorRef={editorRef}
        pageSetupOpen={false}
        onPageSetupOpenChange={() => {}}
      />,
    ),
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(
      container.querySelector('[data-slot="empty"]')?.textContent,
    ).toContain('Could not open this document')
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('Could not open this document.'),
      { id: 'document-open:missing' },
    )
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})

it('renders a Connect Google Drive action when a Google Drive document fails while disconnected', async () => {
  vi.spyOn(toast, 'error').mockImplementation(() => '')
  const onConnectDrive = vi.fn()
  await act(() =>
    root.render(
      <DocumentEditor
        id="Gmissing"
        documentRef={documentRef}
        editorRef={editorRef}
        pageSetupOpen={false}
        onPageSetupOpenChange={() => {}}
        onConnectDrive={onConnectDrive}
      />,
    ),
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(
      container.querySelector('[data-slot="empty"]')?.textContent,
    ).toContain('Could not open this document')
  })
  const button = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent.includes('Connect Google Drive'),
  )
  expect(button).toBeDefined()
  await act(async () => {
    button?.click()
  })
  expect(onConnectDrive).toHaveBeenCalledOnce()

  await act(() =>
    root.render(
      <DocumentSaveStatus
        status={{ phase: 'error', error: 'Drive sync failed' }}
        provider="google-drive"
      />,
    ),
  )
  const statusTrigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Could not save to Drive"]',
  )
  expect(statusTrigger).not.toBeNull()
  await act(async () => {
    statusTrigger?.click()
  })
  const errorText = Array.from(document.body.querySelectorAll('p')).find(
    (el) => el.textContent === 'Drive sync failed',
  )
  expect(errorText).toBeDefined()
  expect(errorText?.getAttribute('role')).toBeNull()
  expect(errorText?.className).toContain('text-muted-foreground')
  expect(errorText?.className).not.toContain('text-destructive')
})
