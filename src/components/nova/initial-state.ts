import { $createHeadingNode } from '@lexical/rich-text'
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical'

export function getInitialState() {
  const root = $getRoot()

  if (root.isEmpty()) {
    const h = $createHeadingNode('h1')
    h.append($createTextNode('Welcome to Concept! 🚀'))

    root.append(h)

    const p1 = $createParagraphNode()
    const t1 = $createTextNode(
      'The default text is used to showcase different features of the editor, including styles, editing tools, and more.',
    )
    p1.append(t1)

    const p2 = $createParagraphNode()
    const t2 = $createTextNode('Reload the page to reset this text.')
    t2.setFormat('italic')
    p2.append(t2)

    root.append(p1)
    root.append(p2)
  }
}
