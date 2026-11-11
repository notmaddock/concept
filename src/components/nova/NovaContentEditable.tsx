import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useSyncExternalStore } from 'react'
import {
  $getNearestNodeFromDOMNode,
  $isElementNode,
  $isRootNode,
} from 'lexical'

const placeholderText = "Begin typing or use '/' for commands…"

export function NovaContentEditable() {
  const [editor] = useLexicalComposerContext()
  const isEditable = useSyncExternalStore(
    (listener) => editor.registerEditableListener(listener),
    () => editor.isEditable(),
    () => true,
  )
  const contentPadding =
    'var(--document-content-padding, 2rem clamp(1.5rem, 6vw, 4rem))'
  const placeholderTop = 'var(--document-placeholder-top, 2rem)'
  const placeholderLeft =
    'var(--document-placeholder-left, clamp(1.5rem, 6vw, 4rem))'

  return (
    <ContentEditable
      aria-label="Document content"
      onMouseDown={(event) => {
        if (event.button !== 0 || event.detail !== 3 || event.shiftKey) return
        editor.update(() => {
          const target = event.target
          if (!(target instanceof Node)) return
          let block = $getNearestNodeFromDOMNode(target)
          while (block && (!$isElementNode(block) || block.isInline()))
            block = block.getParent()
          if (!$isElementNode(block) || $isRootNode(block)) return
          // Native paragraph selection can end after the following decorator block.
          event.preventDefault()
          block.select(0, block.getChildrenSize())
        })
      }}
      data-document-content
      className="min-h-full w-full outline-none"
      style={{
        padding: contentPadding,
      }}
      aria-placeholder={isEditable ? placeholderText : ''}
      placeholder={(editable: boolean) =>
        editable && isEditable ? (
          <span
            className="absolute text-muted-foreground italic pointer-events-none"
            style={{ top: placeholderTop, left: placeholderLeft }}
          >
            {placeholderText}
          </span>
        ) : null
      }
    />
  )
}
