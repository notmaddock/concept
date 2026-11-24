import { $isHeadingNode } from '@lexical/rich-text'
import { $getNodeByKey, SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical'
import type { LexicalEditor, NodeKey } from 'lexical'
import { cn } from '#/lib/utils'
import { headingAnchor } from './outline'
import type { OutlineItem } from './outline'

function jumpToHeading(editor: LexicalEditor, key: NodeKey) {
  const heading = editor.getElementByKey(key)
  if (!heading) return
  if (editor.isEditable()) {
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.update(
      () => {
        const node = $getNodeByKey(key)
        if ($isHeadingNode(node)) node.selectStart()
      },
      { tag: SKIP_SCROLL_INTO_VIEW_TAG },
    )
  } else {
    heading.focus({ preventScroll: true })
  }
  heading.scrollIntoView({ block: 'start', inline: 'nearest' })
}

export function OutlineLinks({
  editor,
  items,
  sidebar = false,
  nested = false,
}: {
  editor: LexicalEditor
  items: readonly OutlineItem[]
  sidebar?: boolean
  nested?: boolean
}) {
  return (
    <ul className={cn('list-none p-0', nested && 'ps-4')}>
      {items.map((item) => (
        <li key={item.key}>
          <a
            href={`#${headingAnchor(item.key)}`}
            className={cn(
              'block rounded-sm wrap-anywhere focus-visible:outline-2 focus-visible:outline-primary',
              sidebar
                ? 'px-2 py-1 hover:bg-accent hover:text-accent-foreground'
                : 'py-0.5 text-primary hover:underline',
            )}
            onClick={(event) => {
              event.preventDefault()
              jumpToHeading(editor, item.key)
            }}
          >
            {item.text}
          </a>
          {item.children.length > 0 && (
            <OutlineLinks
              editor={editor}
              items={item.children}
              sidebar={sidebar}
              nested
            />
          )}
        </li>
      ))}
    </ul>
  )
}
