import {
  $create,
  $getDocument,
  $getState,
  $setState,
  DecoratorNode,
} from 'lexical'
import type { DOMConversionMap, DOMExportOutput, LexicalNode } from 'lexical'
import type { JSX } from 'react'
import { TableOfContentsBlock } from './TableOfContentsBlock'
import { contentsAttribute } from './outline'
import { $createExportedContents } from './outline-html'
import {
  contentsStyleAttribute,
  contentsStyleState,
  parseContentsStyle,
} from './contents-style'

export class TableOfContentsNode extends DecoratorNode<JSX.Element> {
  $config() {
    return this.config('table-of-contents', { extends: DecoratorNode })
  }

  static importDOM(): DOMConversionMap {
    return {
      nav: (element) =>
        element.getAttribute(contentsAttribute) === 'true'
          ? {
              conversion: () => ({
                node: $setState(
                  $createTableOfContentsNode(),
                  contentsStyleState,
                  parseContentsStyle(
                    element.getAttribute(contentsStyleAttribute),
                  ),
                ),
                after: () => [],
              }),
              priority: 3,
            }
          : null,
    }
  }

  createDOM(): HTMLElement {
    return $getDocument().createElement('div')
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): JSX.Element {
    return (
      <TableOfContentsBlock
        nodeKey={this.getKey()}
        style={$getState(this, contentsStyleState)}
      />
    )
  }

  exportDOM(): DOMExportOutput {
    return {
      element: $createExportedContents(
        $getDocument(),
        $getState(this, contentsStyleState),
      ),
    }
  }
}

export function $createTableOfContentsNode(): TableOfContentsNode {
  return $create(TableOfContentsNode)
}

export function $isTableOfContentsNode(
  node: LexicalNode | null | undefined,
): node is TableOfContentsNode {
  return node instanceof TableOfContentsNode
}
