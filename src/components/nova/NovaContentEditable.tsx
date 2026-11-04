import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useSyncExternalStore } from 'react'

const placeholderText = "Begin typing or use '/' for commands…"

export function NovaContentEditable() {
  const [editor] = useLexicalComposerContext()
  const isEditable = useSyncExternalStore(
    (listener) => editor.registerEditableListener(listener),
    () => editor.isEditable(),
    () => true,
  )
  const marginX = 'var(--page-margin-left, clamp(1.5rem, 6vw, 4rem))'
  const marginY = 'var(--page-margin-top, 2rem)'

  return (
    <ContentEditable
      aria-label="Document content"
      data-document-content
      className="min-h-full w-full outline-none"
      style={{
        padding: `${marginY} var(--page-margin-right, clamp(1.5rem, 6vw, 4rem)) var(--page-margin-bottom, 2rem) ${marginX}`,
      }}
      aria-placeholder={isEditable ? placeholderText : ''}
      placeholder={(editable: boolean) =>
        editable && isEditable ? (
          <span
            className="absolute text-muted-foreground italic pointer-events-none"
            style={{ top: `${marginY}`, left: `${marginX}` }}
          >
            {placeholderText}
          </span>
        ) : null
      }
    />
  )
}
