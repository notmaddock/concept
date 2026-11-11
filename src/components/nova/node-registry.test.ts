import { describe, expect, it } from 'vitest'
import { createEditor } from 'lexical'
import { documentNodes } from './node-registry'
import { editorExtension } from './editor'

describe('document node registry', () => {
  it('is the single node list consumed by the editor extension', () => {
    expect(editorExtension.nodes).toBe(documentNodes)
  })

  it('registers every document node in a headless editor', () => {
    const editor = createEditor({
      namespace: 'node-registry-test',
      nodes: documentNodes,
      onError: (error) => {
        throw error
      },
    })
    for (const node of documentNodes) expect(editor.hasNodes([node])).toBe(true)
  })
})
