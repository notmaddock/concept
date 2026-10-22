import { expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { stepFontSize } from './font-size'

it('steps mixed sizes independently and only changes selected characters', async () => {
  const editor = createEditor({
    onError: (error) => {
      throw error
    },
  })
  const root = document.createElement('div')
  root.style.fontSize = '16px'
  document.body.append(root)
  editor.setRootElement(root)
  vi.spyOn(editor, 'focus').mockImplementation(() => {})
  editor.update(
    () => {
      const first = $createTextNode('small').setStyle('font-size: 12pt')
      const second = $createTextNode('large').setStyle('font-size: 24px')
      $getRoot().append($createParagraphNode().append(first, second))
      const selection = first.select(2, 5)
      selection.focus.set(second.getKey(), 3, 'text')
    },
    { discrete: true },
  )
  stepFontSize(editor, 1)
  await Promise.resolve()
  editor.read('latest', () => {
    const nodes = $getRoot().getAllTextNodes()
    expect(nodes.map((node) => node.getTextContent())).toEqual([
      'sm',
      'all',
      'lar',
      'ge',
    ])
    expect(nodes.map((node) => node.getStyle())).toEqual([
      'font-size: 12pt',
      'font-size: 13pt;',
      'font-size: 19pt;',
      'font-size: 24px',
    ])
  })
  stepFontSize(editor, -1)
  await Promise.resolve()
  editor.read('latest', () => {
    expect(
      $getRoot()
        .getAllTextNodes()
        .filter((node) => ['all', 'lar'].includes(node.getTextContent()))
        .map((node) => node.getStyle()),
    ).toEqual(['font-size: 12pt;', 'font-size: 18pt;'])
  })
  editor.setRootElement(null)
  root.remove()
})
