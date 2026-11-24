import { $convertToMarkdownString } from '@lexical/markdown'
import type { ElementTransformer, Transformer } from '@lexical/markdown'
import {
  $isColumnLayoutNode,
  $isColumnNode,
  ColumnLayoutNode,
} from './ColumnLayoutNode'

export function createColumnLayoutMarkdown(
  getTransformers: () => Transformer[],
): ElementTransformer {
  return {
    dependencies: [ColumnLayoutNode],
    export: (node) =>
      $isColumnLayoutNode(node)
        ? node
            .getChildren()
            .filter($isColumnNode)
            .map((column) =>
              $convertToMarkdownString(getTransformers(), column),
            )
            .filter(Boolean)
            .join('\n\n')
        : null,
    regExp: /$^/,
    replace: () => {},
    type: 'element',
  }
}

export const columnLayoutExportCss = `
[data-concept-columns] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 1.5rem; margin: 1rem 0; }
[data-concept-columns]:has(> [data-concept-column]:nth-child(3)) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
[data-concept-column] { min-width: 0; overflow-wrap: anywhere; }
@media screen and (max-width: 40rem) {
  [data-concept-columns]:has(> [data-concept-column]:nth-child(3)) { grid-template-columns: 1fr; }
}
@media screen and (max-width: 28rem) {
  [data-concept-columns] { grid-template-columns: 1fr; }
}
`
