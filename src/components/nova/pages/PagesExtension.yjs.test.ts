import { buildEditorFromExtensions } from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs'
import type { Binding } from '@lexical/yjs'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  defineExtension,
} from 'lexical'
import type { LexicalEditorWithDispose } from 'lexical'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { Text, Transaction, YEvent } from 'yjs'
import { describe, expect, it } from 'vitest'
import {
  $getPageSetup,
  $setPageSetup,
  DEFAULT_PAGE_SETUP,
} from '#/lib/documents/page-setup'
import { LocalProvider } from '#/lib/documents/local-provider'
import { captureDocument } from '#/lib/documents/references'
import { $isPageNode } from './PageNode'
import { PagesExtension } from './PagesExtension'

const testExtension = defineExtension({
  name: 'test-pages-yjs',
  dependencies: [RichTextExtension, PagesExtension],
})

type MountedEditor = {
  editor: LexicalEditorWithDispose
  provider: LocalProvider
  binding: Binding
  rootElement: HTMLDivElement
  unregister: () => void
}

function mountEditor(
  id: string,
  doc: Doc,
  syncLocalChanges: boolean,
): MountedEditor {
  const editor = buildEditorFromExtensions(testExtension)
  const rootElement = document.createElement('div')
  document.body.append(rootElement)
  editor.setRootElement(rootElement)
  const provider = new LocalProvider(id, doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id,
    doc,
    docMap: new Map([[id, doc]]),
  })
  const unregister = syncLocalChanges
    ? editor.registerUpdateListener(
        ({
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        }) =>
          syncLexicalUpdateToYjs(
            binding,
            provider,
            prevEditorState,
            editorState,
            dirtyElements,
            dirtyLeaves,
            normalizedNodes,
            tags,
          ),
      )
    : () => {}

  return { editor, provider, binding, rootElement, unregister }
}

function destroyEditor(mounted: MountedEditor) {
  mounted.unregister()
  mounted.provider.destroy()
  mounted.editor.dispose()
  mounted.rootElement.remove()
}

describe('PagesExtension with Yjs', () => {
  it('captures paper-mode documents without unsupported node errors', async () => {
    const doc = new Doc()
    const mounted = mountEditor('pages-capture', doc, true)
    try {
      mounted.editor.update(
        () => $setPageSetup({ ...DEFAULT_PAGE_SETUP, mode: 'paper' }),
        { discrete: true },
      )
      await Promise.resolve()
      mounted.editor.update(
        () =>
          $getRoot().append(
            $createParagraphNode().append($createTextNode('paper')),
          ),
        { discrete: true },
      )
      await Promise.resolve()
      await Promise.resolve()

      const captured = captureDocument(doc, 'Paper')
      expect(captured.name).toBe('Paper')
      expect([...captured.requiredAssets]).toEqual([])
    } finally {
      destroyEditor(mounted)
      doc.destroy()
    }
  })

  it('round-trips paged structure and page setup through a Yjs document', async () => {
    const doc = new Doc()
    const first = mountEditor('pages-yjs', doc, true)
    const restoredDoc = new Doc()
    const second = mountEditor('pages-yjs-restored', restoredDoc, false)
    const restoredRoot = second.binding.root.getSharedType()
    const observer = (events: YEvent<Text>[], transaction: Transaction) => {
      if (transaction.origin !== second.binding) {
        syncYjsChangesToLexical(second.binding, second.provider, events, false)
      }
    }
    restoredRoot.observeDeep(observer)

    try {
      first.editor.update(
        () => $setPageSetup({ ...DEFAULT_PAGE_SETUP, mode: 'paper' }),
        { discrete: true },
      )
      await Promise.resolve()

      first.editor.update(
        () =>
          $getRoot().append(
            $createParagraphNode().append($createTextNode('one')),
            $createParagraphNode().append($createTextNode('two')),
          ),
        { discrete: true },
      )
      await Promise.resolve()
      await Promise.resolve()

      first.editor.getEditorState().read(() => {
        const children = $getRoot().getChildren()
        expect(children.every($isPageNode)).toBe(true)
        expect(children.length).toBeGreaterThan(0)
      })

      applyUpdate(restoredDoc, encodeStateAsUpdate(doc))
      await Promise.resolve()
      await Promise.resolve()

      const result = second.editor.getEditorState().read(() => {
        const setup = $getPageSetup()
        const children = $getRoot().getChildren()
        return {
          mode: setup.mode,
          allPages: children.every($isPageNode),
          pageCount: children.filter($isPageNode).length,
          text: children.flatMap((page) =>
            $isPageNode(page)
              ? page
                  .getContentNode()
                  .getChildren()
                  .map((node) => node.getTextContent())
              : [],
          ),
        }
      })

      expect(result.mode).toBe('paper')
      expect(result.allPages).toBe(true)
      expect(result.pageCount).toBeGreaterThan(0)
      expect(result.text).toContain('one')
      expect(result.text).toContain('two')
    } finally {
      restoredRoot.unobserveDeep(observer)
      destroyEditor(second)
      destroyEditor(first)
      doc.destroy()
      restoredDoc.destroy()
    }
  })
})
