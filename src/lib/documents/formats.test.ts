import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { documentFormats, exportFormats } from './formats'
import { serializeExport } from './export'

describe('document formats', () => {
  it('gives every format a distinct extension', () => {
    const extensions = Object.values(documentFormats).flatMap(
      (format) => format.extensions,
    )
    expect(new Set(extensions).size).toBe(extensions.length)
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
})
