import { ContentEditable } from '@lexical/react/LexicalContentEditable'

const placeholderText = "Begin typing or use '/' for commands…"

export function NovaContentEditable() {
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
      aria-placeholder={placeholderText}
      placeholder={
        <span
          className="absolute text-muted-foreground italic pointer-events-none"
          style={{ top: `${marginY}`, left: `${marginX}` }}
        >
          {placeholderText}
        </span>
      }
    />
  )
}
