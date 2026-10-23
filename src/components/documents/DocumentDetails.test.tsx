import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { Doc } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import {
  DocumentDetailsDialog,
  DocumentDetailsPopover,
} from './DocumentDetails'
import { localDocumentStorage } from '#/lib/documents/storages/local'
import { serializeConcept } from '#/lib/documents/concept-file'
import * as serialization from '#/lib/documents/serialization'

let root: Root
let container: HTMLDivElement
let doc: Doc
const info = { id: 'test-document', name: 'My notes', updatedAt: 1700000000000 }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  doc = new Doc()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  doc.destroy()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function value(label: string) {
  return Array.from(document.querySelectorAll('dt')).find(
    (item) => item.textContent === label,
  )?.nextElementSibling?.textContent
}

it('shows metadata, live word counts, and the serialized download size', async () => {
  const editor = createEditor()
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Hello world 🌎')),
      )
    },
    { discrete: true },
  )
  await act(async () =>
    root.render(
      <DocumentDetailsDialog
        document={info}
        documentRef={{ current: doc }}
        editorRef={{ current: editor }}
        onOpenChange={() => {}}
      />,
    ),
  )
  expect(value('Name')).toBe('My notes')
  expect(value('Library updated')).toBe(
    new Date(info.updatedAt).toLocaleString(),
  )
  expect(value('Location')).toBe('This browser')
  expect(value('Words')).toBe('2')
  expect(value('Characters')).toBe('13')
  expect(value('File size (.concept)')).toContain(
    `${new Blob([serializeConcept(info.name, doc)]).size} bytes`,
  )
  await act(async () =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('One two three')),
          )
      },
      { discrete: true },
    ),
  )
  expect(value('Words')).toBe('3')
})

it('waits for the existing editor session instead of opening another document', async () => {
  vi.useFakeTimers()
  const documentRef: { current: Doc | null } = { current: null }
  const editorRef: { current: ReturnType<typeof createEditor> | null } = {
    current: null,
  }
  await act(async () =>
    root.render(
      <DocumentDetailsDialog
        document={info}
        documentRef={documentRef}
        editorRef={editorRef}
        onOpenChange={() => {}}
      />,
    ),
  )
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    'Waiting',
  )
  documentRef.current = doc
  editorRef.current = createEditor()
  await act(async () => {
    vi.advanceTimersByTime(100)
  })
  expect(value('Words')).toBe('0')
  expect(document.querySelector('[role="status"]')).toBeNull()
})

it('opens sidebar metadata only after a second without loading document content', async () => {
  vi.useFakeTimers()
  const openDocument = vi.spyOn(localDocumentStorage, 'open')
  await act(async () =>
    root.render(
      <DocumentDetailsPopover document={info}>
        <a href="#document">My notes</a>
      </DocumentDetailsPopover>,
    ),
  )
  const trigger = container.querySelector('a')!
  await act(async () => {
    const pointer = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
    trigger.dispatchEvent(pointer)
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(999)
  })
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  await act(async () => {
    vi.advanceTimersByTime(1)
  })
  expect(
    document.querySelector('[data-slot="popover-content"]')?.textContent,
  ).toContain('This browser')
  expect(value('Document ID')).toBeUndefined()
  expect(value('Words')).toBeUndefined()
  expect(openDocument).not.toHaveBeenCalled()
  openDocument.mockRestore()
})

it('coalesces document updates and skips serialization for selection-only changes', async () => {
  const serialize = vi.spyOn(serialization, 'serializeConcept')
  const editor = createEditor()
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Initial')),
      )
    },
    { discrete: true },
  )
  await act(async () =>
    root.render(
      <DocumentDetailsDialog
        document={info}
        documentRef={{ current: doc }}
        editorRef={{ current: editor }}
        onOpenChange={() => {}}
      />,
    ),
  )
  serialize.mockClear()
  await act(async () => {
    editor.update(
      () => {
        $getRoot().getFirstChild()?.selectEnd()
      },
      { discrete: true },
    )
  })
  expect(serialize).not.toHaveBeenCalled()
  await act(async () => {
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('updated')),
        )
      },
      { discrete: true },
    )
    doc.getText('statistics').insert(0, 'update')
  })
  expect(serialize).toHaveBeenCalledTimes(1)
  expect(value('Words')).toBe('2')
  serialize.mockRestore()
})
