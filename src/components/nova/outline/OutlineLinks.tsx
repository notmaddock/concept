import type { LexicalEditor, NodeKey } from 'lexical'
import { cn } from '#/lib/utils'
import { headingFragment } from '#/lib/documents/document-url'
import type { OutlineItem } from './outline'
import { openHeading } from './HeadingNavigationPlugin'
import type { ContentsStyle } from './contents-style'

export function OutlineLinks({
  editor,
  items,
  sidebar = false,
  nested = false,
  current,
  style = 'links',
}: {
  editor: LexicalEditor
  items: readonly OutlineItem[]
  sidebar?: boolean
  nested?: boolean
  current?: NodeKey | null
  style?: ContentsStyle
}) {
  return (
    <ul className={cn('list-none p-0', nested && 'ps-4')}>
      {items.map((item) => (
        <li key={item.key}>
          <a
            href={`#${headingFragment(item.id, window.location)}`}
            aria-current={
              sidebar && current === item.key ? 'location' : undefined
            }
            className={cn(
              'flex items-baseline gap-2 rounded-sm wrap-anywhere focus-visible:outline-2 focus-visible:outline-primary',
              sidebar
                ? 'px-2 py-1 hover:bg-accent hover:text-accent-foreground aria-[current=location]:bg-accent aria-[current=location]:font-medium aria-[current=location]:text-accent-foreground'
                : 'py-0.5 text-primary hover:underline',
            )}
            onClick={(event) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              )
                return
              event.preventDefault()
              openHeading(editor, item.key, item.id)
            }}
          >
            <span className="min-w-0">{item.text}</span>
            {style !== 'links' && item.page !== null && (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'min-w-2 flex-1',
                    style === 'dotted' &&
                      'border-b border-dotted border-current opacity-40',
                  )}
                />
                <span className="tabular-nums" aria-label={`Page ${item.page}`}>
                  {item.page}
                </span>
              </>
            )}
          </a>
          {item.children.length > 0 && (
            <OutlineLinks
              editor={editor}
              items={item.children}
              sidebar={sidebar}
              current={current}
              style={style}
              nested
            />
          )}
        </li>
      ))}
    </ul>
  )
}
