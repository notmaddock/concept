import { $generateNodesFromDOM } from '@lexical/html'
import { $getRoot, $insertNodes } from 'lexical'
import type { LexicalEditor } from 'lexical'

export function convertHtml(content: string, editor: LexicalEditor) {
  const html = new DOMParser().parseFromString(content, 'text/html')
  html
    .querySelectorAll('script,style,iframe,object,embed,template')
    .forEach((node) => node.remove())
  $getRoot().select()
  $insertNodes($generateNodesFromDOM(editor, html))
}
