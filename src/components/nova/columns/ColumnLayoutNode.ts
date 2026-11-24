import {
  $create,
  $createParagraphNode,
  $getDocument,
  ElementNode,
} from 'lexical'
import type { LexicalNode } from 'lexical'

const layoutAttribute = 'data-concept-columns'
const columnAttribute = 'data-concept-column'

function isColumnLayoutElement(element: HTMLElement) {
  return (
    element.matches(`section[${layoutAttribute}]`) &&
    !element.parentElement?.closest(`[${layoutAttribute}], td, th`) &&
    [2, 3].includes(element.children.length) &&
    [...element.children].every((child) =>
      child.matches(`div[${columnAttribute}]`),
    ) &&
    [...element.childNodes].every(
      (child) => child.nodeType !== 3 || !child.textContent?.trim(),
    )
  )
}

export class ColumnLayoutNode extends ElementNode {
  $config() {
    return this.config('column-layout', {
      extends: ElementNode,
      importDOM: {
        section: (element) =>
          isColumnLayoutElement(element)
            ? {
                conversion: () => ({ node: $createColumnLayoutNode() }),
                priority: 2,
              }
            : null,
      },
    })
  }

  createDOM(): HTMLElement {
    const element = $getDocument().createElement('section')
    element.setAttribute(layoutAttribute, '')
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isShadowRoot(): boolean {
    return true
  }

  canIndent(): boolean {
    return false
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }
}

export class ColumnNode extends ElementNode {
  $config() {
    return this.config('column', {
      children: 'block',
      extends: ElementNode,
      importDOM: {
        div: (element) =>
          element.hasAttribute(columnAttribute) &&
          element.parentElement &&
          isColumnLayoutElement(element.parentElement)
            ? {
                conversion: () => ({
                  after: (children) =>
                    children.length ? children : [$createParagraphNode()],
                  node: $create(ColumnNode),
                }),
                priority: 2,
              }
            : null,
      },
    })
  }

  createDOM(): HTMLElement {
    const element = $getDocument().createElement('div')
    element.setAttribute(columnAttribute, '')
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isShadowRoot(): boolean {
    return true
  }

  canIndent(): boolean {
    return false
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }
}

export function $createColumnLayoutNode(): ColumnLayoutNode {
  return $create(ColumnLayoutNode)
}

export function $createColumnNode(): ColumnNode {
  return $create(ColumnNode).append($createParagraphNode())
}

export function $isColumnLayoutNode(
  node: LexicalNode | null | undefined,
): node is ColumnLayoutNode {
  return node instanceof ColumnLayoutNode
}

export function $isColumnNode(
  node: LexicalNode | null | undefined,
): node is ColumnNode {
  return node instanceof ColumnNode
}
