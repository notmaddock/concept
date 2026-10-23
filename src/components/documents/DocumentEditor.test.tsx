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
import { localDocumentStorage } from '#/lib/documents/storage'
import {
  importConcept,
  parseConcept,
  serializeConcept,
} from '#/lib/documents/concept-file'
import { DocumentEditor } from './DocumentEditor'

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
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
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

it('replaces the loading state with an error when stored content cannot be opened', async () => {
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not open this document',
    )
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
