import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown'
import type {
  MultilineElementTransformer,
  Transformer,
} from '@lexical/markdown'
import {
  $computeTableMapSkipCellCheck,
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import { $createParagraphNode, $isElementNode } from 'lexical'
import { marked } from 'marked'
import type { Tokens } from 'marked'

const tableDivider =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

export function createTableMarkdown(
  getTransformers: () => Transformer[],
): MultilineElementTransformer {
  return {
    type: 'multiline-element',
    dependencies: [TableNode, TableRowNode, TableCellNode],
    regExpStart: /^ {0,3}\S.*\||^ {0,3}\|/,
    replace: () => false,
    handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
      const divider = lines.at(startLineIndex + 1)
      if (divider === undefined || !tableDivider.test(divider)) return null
      let end = startLineIndex + 2
      while (end < lines.length && lines[end].trim()) end++
      const sample = lines.slice(startLineIndex, end).join('\n')
      const token = marked.lexer(sample, { gfm: true }).at(0)
      if (token?.type !== 'table') return null
      const { header, rows, align, raw } = token as Tokens.Table
      const table = $createTableNode()
      const inline = getTransformers().filter(
        ({ type }) => type === 'text-format' || type === 'text-match',
      )
      for (const [rowIndex, entries] of [header, ...rows].entries()) {
        const row = $createTableRowNode()
        for (const [columnIndex, { text }] of entries.entries()) {
          const cell = $createTableCellNode(
            rowIndex === 0
              ? TableCellHeaderStates.ROW
              : TableCellHeaderStates.NO_STATUS,
          )
          $convertFromMarkdownString(text, inline, cell)
          const alignment = align[columnIndex]
          if (alignment) {
            for (const child of cell.getChildren()) {
              if ($isElementNode(child)) child.setFormat(alignment)
            }
          }
          if (cell.isEmpty()) cell.append($createParagraphNode())
          row.append(cell)
        }
        table.append(row)
      }
      rootNode.append(table)
      return [true, startLineIndex + raw.trimEnd().split('\n').length - 1]
    },
    export(node) {
      if (!$isTableNode(node)) return null
      const [map] = $computeTableMapSkipCellCheck(node, null, null)
      const firstRow = map.at(0)
      if (!firstRow?.length) return null
      const rows = map.map((entries, row) => {
        const cells = Array.from({ length: firstRow.length }, (_, column) => {
          const entry = entries.at(column)
          if (!entry || entry.startRow !== row || entry.startColumn !== column)
            return ''
          return $convertToMarkdownString(getTransformers(), entry.cell)
            .trim()
            .replace(/\s*\n\s*/g, ' ')
            .replace(/(?<!\\)\|/g, '\\|')
        })
        return `| ${cells.join(' | ')} |`
      })
      const alignments = firstRow.map(({ cell }) => {
        const child = cell.getFirstChild()
        const format = $isElementNode(child) && child.getFormatType()
        if (format === 'left') return ':---'
        if (format === 'center') return ':---:'
        if (format === 'right') return '---:'
        return '---'
      })
      const separator = `| ${alignments.join(' | ')} |`
      return [rows[0], separator, ...rows.slice(1)].join('\n')
    },
  }
}
