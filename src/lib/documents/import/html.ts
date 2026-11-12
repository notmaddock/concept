import { $generateNodesFromDOM } from '@lexical/html'
import { $getRoot, $insertNodes } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $applyLinkPolicy } from '../link-policy'

export function convertHtml(content: string, editor: LexicalEditor) {
  const html = new DOMParser().parseFromString(content, 'text/html')
  html
    .querySelectorAll('script,style,iframe,object,embed,template')
    .forEach((node) => node.remove())
  html
    .querySelectorAll('img:not([data-concept-image-source])')
    .forEach((image) => {
      const alt = image.getAttribute('alt')
      image.replaceWith(
        html.createTextNode(alt ? `[Image: ${alt}]` : '[Image]'),
      )
    })
  $getRoot().select()
  $insertNodes($generateNodesFromDOM(editor, html))
  $applyLinkPolicy()
}
