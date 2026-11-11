import { getExtensionDependencyFromEditor } from '@lexical/extension'
import {
  $create,
  $getDocument,
  $getEditor,
  addClassNamesToElement,
  ElementNode,
} from 'lexical'
import type { LexicalNode } from 'lexical'
import { $createPageContentNode, $isPageContentNode } from './PageContentNode'
import type { PageContentNode } from './PageContentNode'
import { PagesExtension } from './PagesExtension'

/** A single sheet of paper. It always owns exactly one PageContentNode. */
export class PageNode extends ElementNode {
  $config() {
    return this.config('page', {
      extends: ElementNode,
    })
  }

  getContentNode(): PageContentNode {
    const content = this.getChildren().find($isPageContentNode)
    if (!content) {
      throw new Error('PageNode: Content node not found')
    }
    return content
  }

  createDOM(): HTMLElement {
    const dom = $getDocument().createElement('div')
    addClassNamesToElement(
      dom,
      getExtensionDependencyFromEditor($getEditor(), PagesExtension).config
        .pageClass,
    )
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  getPageNumber(): number {
    const parent = this.getParent()
    if (parent === null) {
      return -1
    }
    let node = parent.getFirstChild()
    let index = 0
    while (node !== null) {
      if (this.is(node)) {
        return index + 1
      }
      if ($isPageNode(node)) {
        index++
      }
      node = node.getNextSibling()
    }
    return -1
  }

  getPageElement(): HTMLElement | null {
    return $getEditor().getElementByKey(this.getKey())
  }

  getPageContentElement(): HTMLElement | null {
    return $getEditor().getElementByKey(this.getContentNode().getKey())
  }

  getPreviousPage(): PageNode | null {
    let previousSibling = this.getPreviousSibling()
    while (previousSibling && !$isPageNode(previousSibling)) {
      previousSibling = previousSibling.getPreviousSibling()
    }
    return $isPageNode(previousSibling) ? previousSibling : null
  }

  getNextPage(): PageNode | null {
    let nextSibling = this.getNextSibling()
    while (nextSibling && !$isPageNode(nextSibling)) {
      nextSibling = nextSibling.getNextSibling()
    }
    return $isPageNode(nextSibling) ? nextSibling : null
  }

  excludeFromCopy(): boolean {
    return true
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }
}

export function $createPageNode(): PageNode {
  return $create(PageNode).append($createPageContentNode())
}

export function $isPageNode(
  node: LexicalNode | null | undefined,
): node is PageNode {
  return node instanceof PageNode
}
