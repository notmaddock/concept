import { ContentEditable } from '@lexical/react/LexicalContentEditable'

const placeholderText = "Begin typing or use '/' for commands…"

export function NovaContentEditable() {
  const marginX = '4em'
  const marginY = '2em'

  return (
    <ContentEditable
      className="size-full outline-none"
      style={{ padding: `${marginY} ${marginX}` }}
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
