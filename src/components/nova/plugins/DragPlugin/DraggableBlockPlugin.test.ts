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
import { PagesExtension } from '#/components/nova/pages'
import { $isPageContentNode } from '#/components/nova/pages/PageContentNode'
import { $isPageNode } from '#/components/nova/pages/PageNode'
import { $getDragContainer } from './DraggableBlockPlugin'

const testExtension = defineExtension({
  name: 'test-drag-pages',
  dependencies: [RichTextExtension, PagesExtension],
})

let editor: LexicalEditorWithDispose
let rootElement: HTMLDivElement

beforeEach(() => {
  rootElement = document.createElement('div')
  document.body.append(rootElement)
  editor = buildEditorFromExtensions(testExtension)
  editor.setRootElement(rootElement)
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('one')),
          $createParagraphNode().append($createTextNode('two')),
        )
      $setPageSetup({ ...DEFAULT_PAGE_SETUP, mode: 'paper' })
    },
    { discrete: true },
  )
})

afterEach(() => {
  editor.dispose()
  rootElement.remove()
})

describe('$getDragContainer', () => {
  it('uses the PageContentNode under a paragraph in paged mode', async () => {
    await Promise.resolve()
    await Promise.resolve()

    const { pageKey, paragraphKeys } = editor.getEditorState().read(() => {
      const page = $getRoot().getFirstChild()
      if (!$isPageNode(page)) throw new Error('Expected a PageNode')
      return {
        pageKey: page.getKey(),
        paragraphKeys: page.getContentNode().getChildrenKeys(),
      }
    })

    const paragraphElement = editor.getElementByKey(paragraphKeys[0])
    expect(paragraphElement).not.toBeNull()

    const { container, keys } = editor.read(() => {
      const dragContainer = $getDragContainer(paragraphElement)
      return { container: dragContainer, keys: dragContainer.getChildrenKeys() }
    })
    expect($isPageContentNode(container)).toBe(true)
    expect(keys).toEqual(paragraphKeys)

    const pageElement = editor.getElementByKey(pageKey)
    expect(pageElement).not.toBeNull()
    const pageContainer = editor.read(() => $getDragContainer(pageElement))
    expect($isPageContentNode(pageContainer)).toBe(true)
  })

  it('falls back to the root for targets outside the editor', () => {
    const outside = document.createElement('div')
    const container = editor.read(() => $getDragContainer(outside))
    expect(container.getKey()).toBe('root')
  })
})
