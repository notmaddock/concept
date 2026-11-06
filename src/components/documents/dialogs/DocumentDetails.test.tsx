import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import {
  DocumentDetailsDialog,
  DocumentDetailsPopover,
} from './DocumentDetails'
import { localDocumentStorage } from '#/lib/documents/storage'
import * as yjs from 'yjs'
import type * as YjsModule from 'yjs'

vi.mock('yjs', async (original) => {
  const actual = await original<typeof YjsModule>()
  return { ...actual, encodeStateAsUpdate: vi.fn(actual.encodeStateAsUpdate) }
})

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
  document.body.append(container)
  root = createRoot(container)
  doc = new Doc()
})

afterEach(async () => {
  await act(() => root.unmount())
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

it('shows metadata, live word counts, and the document state size', async () => {
  const editor = createEditor()
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Hello world 🌎')),
      )
    },
    { discrete: true },
  )
  await act(() =>
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
  expect(value('Document state')).toContain(
    `${encodeStateAsUpdate(doc).byteLength} bytes`,
  )
  await act(async () => {
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('One two three')),
          )
      },
      { discrete: true },
    )
    await Promise.resolve()
  })
  expect(value('Words')).toBe('3')
})

it('waits for the existing editor session instead of opening another document', async () => {
  vi.useFakeTimers()
  const documentRef: { current: Doc | null } = { current: null }
  const editorRef: { current: ReturnType<typeof createEditor> | null } = {
    current: null,
  }
  await act(() =>
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
  await act(() => vi.advanceTimersByTime(100))
  expect(value('Words')).toBe('0')
  expect(document.querySelector('[role="status"]')).toBeNull()
})

it('opens sidebar metadata only after a second without loading document content', async () => {
  vi.useFakeTimers()
  const openDocument = vi.spyOn(localDocumentStorage, 'open')
  await act(() =>
    root.render(
      <DocumentDetailsPopover document={info}>
        <a href="#document">My notes</a>
      </DocumentDetailsPopover>,
    ),
  )
  const trigger = container.querySelector('a')!
  await act(() => {
    const pointer = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
    trigger.dispatchEvent(pointer)
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
  })
  await act(() => vi.advanceTimersByTime(999))
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  await act(() => vi.advanceTimersByTime(1))
  expect(
    document.querySelector('[data-slot="popover-content"]')?.textContent,
  ).toContain('This browser')
  expect(value('Document ID')).toBeUndefined()
  expect(value('Words')).toBeUndefined()
  expect(openDocument).not.toHaveBeenCalled()
  openDocument.mockRestore()
})

it('coalesces document updates and skips serialization for selection-only changes', async () => {
  const serialize = vi.spyOn(yjs, 'encodeStateAsUpdate')
  const editor = createEditor()
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Initial')),
      )
    },
    { discrete: true },
  )
  await act(() =>
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
  await act(() => {
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
    await Promise.resolve()
  })
  expect(serialize).toHaveBeenCalledTimes(1)
  expect(value('Words')).toBe('2')
  serialize.mockRestore()
})
