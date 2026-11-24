import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ListTreeIcon, XIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LexicalEditor } from 'lexical'
import { Button } from '#/components/ui/button'
import { OutlineLinks } from './OutlineLinks'
import { useCurrentHeading, useOutline } from './use-outline'

export function DocumentOutline({
  editor,
  onClose,
}: {
  editor: LexicalEditor
  onClose?: () => void
}) {
  const outline = useOutline(editor)
  const current = useCurrentHeading(editor)
  const navigation = useRef<HTMLElement>(null)

  useEffect(() => {
    navigation.current?.focus({ preventScroll: true })
  }, [])

  return (
    <nav
      ref={navigation}
      tabIndex={-1}
      aria-label="Document outline"
      className="flex h-full min-h-0 min-w-0 flex-col p-3"
    >
      <div className="flex shrink-0 items-center gap-2 px-2 pb-2 text-sm font-medium">
        <ListTreeIcon aria-hidden="true" className="size-4" />
        <span>Document outline</span>
        {onClose && (
          <Button
            aria-label="Close document outline"
            className="ms-auto"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto text-sm">
        {outline.length ? (
          <OutlineLinks
            editor={editor}
            items={outline}
            sidebar
            current={current}
          />
        ) : (
          <p className="px-2 text-muted-foreground">
            Add headings to build the outline.
          </p>
        )}
      </div>
    </nav>
  )
}

export function DocumentOutlinePlugin({
  container,
  onClose,
}: {
  container: HTMLElement | null
  onClose?: () => void
}) {
  const [editor] = useLexicalComposerContext()
  if (!container) return null
  return createPortal(
    <DocumentOutline editor={editor} onClose={onClose} />,
    container,
  )
}
