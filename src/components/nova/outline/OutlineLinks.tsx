import type { LexicalEditor } from 'lexical'
import { cn } from '#/lib/utils'
import { headingAnchor } from './outline'
import type { OutlineItem } from './outline'

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
              const heading = editor.getElementByKey(item.key)
              heading?.focus({ preventScroll: true })
              heading?.scrollIntoView({ block: 'start', inline: 'nearest' })
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
