import { buildEditorFromExtensions } from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  defineExtension,
} from 'lexical'
import type { LexicalEditorWithDispose } from 'lexical'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { $setPageSetup, DEFAULT_PAGE_SETUP } from '#/lib/documents/page-setup'
import type { PageSetup } from '#/lib/documents/page-setup'
import { $createPageBreakNode, $isPageBreakNode } from './PageBreakNode'
import { INSERT_PAGE_BREAK } from './PageBreakExtension'
import { $isPageNode } from './PageNode'
import { PagesExtension } from './PagesExtension'

const testExtension = defineExtension({
  name: 'test-pages',
  dependencies: [RichTextExtension, PagesExtension],
})

const setup = (mode: PageSetup['mode']): PageSetup => ({
  ...DEFAULT_PAGE_SETUP,
  mode,
})

let editor: LexicalEditorWithDispose
let rootElement: HTMLDivElement

const setMode = (mode: PageSetup['mode']) =>
  editor.update(() => $setPageSetup(setup(mode)), { discrete: true })

const rootTypes = () =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getType()),
  )

beforeEach(() => {
  rootElement = document.createElement('div')
  document.body.append(rootElement)
  editor = buildEditorFromExtensions(testExtension)
  editor.setRootElement(rootElement)
  editor.update(
    () =>
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('one')),
          $createParagraphNode().append($createTextNode('two')),
        ),
    { discrete: true },
  )
})

afterEach(() => {
  editor.dispose()
  rootElement.remove()
})

describe('PagesExtension', () => {
  it('wraps root content into a page when paper mode is enabled', async () => {
    setMode('paper')
    await Promise.resolve()

    const structure = editor.getEditorState().read(() => {
      const children = $getRoot().getChildren()
      return children.map((child) =>
        $isPageNode(child)
          ? {
              type: child.getType(),
              content: child
                .getContentNode()
                .getChildren()
                .map((node) => node.getType()),
            }
          : { type: child.getType(), content: [] },
      )
    })

    expect(structure).toEqual([
      { type: 'page', content: ['paragraph', 'paragraph'] },
    ])
  })

  it('unwraps pages when the document returns to pageless mode', async () => {
    setMode('paper')
    await Promise.resolve()
    expect(rootTypes()).toEqual(['page'])

    setMode('pageless')
    await Promise.resolve()

    expect(rootTypes()).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps page breaks at the root between pages', async () => {
    setMode('paper')
    await Promise.resolve()

    editor.update(
      () => {
        const page = $getRoot().getFirstChild()
        if ($isPageNode(page)) {
          page.getContentNode().append($createPageBreakNode())
        }
      },
      { discrete: true },
    )
    await Promise.resolve()
    await Promise.resolve()

    const types = rootTypes()
    expect(types).toEqual(['page', 'page-break', 'page'])
    expect(
      editor.getEditorState().read(() => {
        const breakNode = $getRoot().getChildAtIndex(1)
        return $isPageBreakNode(breakNode)
      }),
    ).toBe(true)
  })

  it('inserts a page break through the INSERT_PAGE_BREAK command', async () => {
    setMode('paper')
    await Promise.resolve()

    editor.update(
      () => {
        const page = $getRoot().getFirstChild()
        if ($isPageNode(page)) {
          page.getContentNode().getFirstChild()?.selectEnd()
        }
      },
      { discrete: true },
    )
    expect(editor.dispatchCommand(INSERT_PAGE_BREAK, undefined)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(rootTypes()).toEqual(['page', 'page-break', 'page'])
  })

  it('wraps content when a paper document is mounted', () => {
    editor.dispose()
    editor = buildEditorFromExtensions(testExtension)
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('one')),
            $createParagraphNode().append($createTextNode('two')),
          )
        $setPageSetup(setup('paper'))
      },
      { discrete: true },
    )
    editor.setRootElement(rootElement)

    expect(rootTypes()).toEqual(['page'])
    expect(
      editor.getEditorState().read(() => {
        const page = $getRoot().getFirstChild()
        return $isPageNode(page) ? page.getContentNode().getChildrenSize() : -1
      }),
    ).toBe(2)
  })

  it('round-trips page nodes through editor state JSON', async () => {
    setMode('paper')
    await Promise.resolve()

    const restored = editor.parseEditorState(editor.getEditorState().toJSON())
    restored.read(() => {
      expect($isPageNode($getRoot().getFirstChild())).toBe(true)
    })
  })
})
