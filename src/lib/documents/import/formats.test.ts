import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { documentFormats, exportFormats, importFormats } from './formats'
import type { ExportFormat } from './formats'
import { serializeExport } from '../export'

describe('document formats', () => {
  it('keeps import and export format lists independent', () => {
    expect(importFormats.map((format) => format.id)).toEqual([
      'markdown',
      'html',
      'text',
    ])
    expect(exportFormats.map((format) => format.id)).toEqual([
      'markdown',
      'html',
      'text',
    ])
    for (const format of exportFormats)
      expect(documentFormats[format.id]).toBe(format)
  })

  it('serializes every export format through its definition', async () => {
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Hello')),
        )
      },
      { discrete: true },
    )
    for (const format of exportFormats) {
      const file = await serializeExport(editor, 'Test', format.id)
      expect(file.extension).toBe(format.extension)
      expect(file.mime).toBe(format.mime)
      expect(file.content).toContain('Hello')
    }
  })

  it('accepts the export format union at the serializer boundary', async () => {
    const format: ExportFormat = 'text'
    expect(exportFormats.some((item) => item.id === format)).toBe(true)
  })
})
