import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import {
  $getDocument,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  mergeRegister,
} from 'lexical'
import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { useEffect } from 'react'
import type { JSX } from 'react'

export type SerializedPageBreakNode = SerializedLexicalNode

function PageBreakComponent({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey)

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const pageBreakElement = editor.getElementByKey(nodeKey)
          if (event.target !== pageBreakElement) return false
          if (!event.shiftKey) clearSelection()
          setSelected(!isSelected)
          return true
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [clearSelection, editor, isSelected, nodeKey, setSelected])

  useEffect(() => {
    const pageBreakElement = editor.getElementByKey(nodeKey)
    if (pageBreakElement !== null) {
      pageBreakElement.className = isSelected ? 'selected' : ''
    }
  }, [editor, isSelected, nodeKey])

  return null
}

/** A manual page break. It lives at the root, between PageNodes. */
export class PageBreakNode extends DecoratorNode<JSX.Element> {
  $config() {
    return this.config('page-break', { extends: DecoratorNode })
  }

  createDOM(): HTMLElement {
    const element = $getDocument().createElement('hr')
    element.style.pageBreakAfter = 'always'
    element.setAttribute('data-lexical-page-break', 'true')
    return element
  }

  getTextContent(): string {
    return '\n'
  }

  isInline(): false {
    return false
  }

  updateDOM(): boolean {
    return false
  }

  decorate(): JSX.Element {
    return <PageBreakComponent nodeKey={this.getKey()} />
  }
}

export function $createPageBreakNode(): PageBreakNode {
  return new PageBreakNode()
}

export function $isPageBreakNode(
  node: LexicalNode | null | undefined,
): node is PageBreakNode {
  return node instanceof PageBreakNode
}
