import {
  $getState,
  $isElementNode,
  $setState,
  createState,
  DEFAULT_EDITOR_DOM_CONFIG,
} from 'lexical'
import type { ElementNode, LexicalNode } from 'lexical'

const properties = ['line-height', 'margin-top', 'margin-bottom'] as const
// ElementNode's generic style is not serialized; NodeState survives save and collaboration.
const paragraphStyleState = createState('paragraphStyle', {
  parse: (value) => (typeof value === 'string' ? value : ''),
})

let sharedStyle: CSSStyleDeclaration | null = null

function getSharedStyle(ownerDocument?: Document): CSSStyleDeclaration | null {
  if (sharedStyle) return sharedStyle
  if (ownerDocument && typeof ownerDocument.createElement === 'function') {
    sharedStyle = ownerDocument.createElement('span').style
    return sharedStyle
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    sharedStyle = document.createElement('span').style
    return sharedStyle
  }
  return null
}

export function $getParagraphStyle(node: LexicalNode) {
  return $getState(node, paragraphStyleState)
}

export function $setParagraphStyle(node: ElementNode, value: string) {
  $setState(node, paragraphStyleState, value)
}

function $decorateParagraph(node: LexicalNode, dom: HTMLElement) {
  if (!$isElementNode(node)) return
  const style = getSharedStyle(dom.ownerDocument)
  if (!style) return
  style.cssText = $getParagraphStyle(node)
  for (const property of properties) {
    const value = style.getPropertyValue(property)
    if (value) dom.style.setProperty(property, value)
    else dom.style.removeProperty(property)
  }
}

export const paragraphDOM = {
  $decorateDOM: (
    node: LexicalNode,
    _previous: LexicalNode | null,
    dom: HTMLElement,
  ) => {
    $decorateParagraph(node, dom)
  },
  $exportDOM: (
    node: LexicalNode,
    editor: Parameters<typeof DEFAULT_EDITOR_DOM_CONFIG.$exportDOM>[1],
  ) => {
    const output = DEFAULT_EDITOR_DOM_CONFIG.$exportDOM(node, editor)
    const after = output.after
    return {
      ...output,
      after: (
        element: HTMLElement | DocumentFragment | Text | null | undefined,
      ) => {
        const result = after ? after.call(node, element) : element
        if (result instanceof HTMLElement) $decorateParagraph(node, result)
        return result
      },
    }
  },
}
