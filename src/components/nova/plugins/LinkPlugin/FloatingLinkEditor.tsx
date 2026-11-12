import { useEffect, useRef, useState } from 'react'
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { linkAttributes, normalizeLinkUrl } from '#/lib/documents/link-policy'

export type FloatingLinkRect = {
  top: number
  left: number
  width: number
  height: number
}

export function FloatingLinkEditor({
  rect,
  url,
  text,
  onSubmit,
  onRemove,
  onClose,
}: {
  rect: FloatingLinkRect
  url: string
  text: string
  onSubmit: (value: { url: string; text: string }) => boolean
  onRemove: () => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftUrl, setDraftUrl] = useState(url)
  const [draftText, setDraftText] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(false)
    setDraftUrl(url)
    setDraftText(text)
  }, [url, text])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const attributes = linkAttributes(url)
  const top =
    rect.top + rect.height + 8 > window.innerHeight - 120
      ? Math.max(8, rect.top - 120)
      : rect.top + rect.height + 8
  const left = Math.min(
    Math.max(8, rect.left),
    Math.max(8, window.innerWidth - 320),
  )

  return (
    <div
      role="dialog"
      aria-label="Link editor"
      data-link-editor="true"
      className="fixed z-50 w-80 max-w-[calc(100vw-1rem)] rounded-3xl border bg-popover p-2.5 text-popover-foreground shadow-lg"
      style={{ top, left }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (editing) setEditing(false)
          else onClose()
        }
      }}
    >
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (onSubmit({ url: draftUrl, text: draftText })) setEditing(false)
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="floating-link-url" className="text-xs">
              URL
            </Label>
            <Input
              ref={inputRef}
              id="floating-link-url"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="floating-link-text" className="text-xs">
              Text
            </Label>
            <Input
              id="floating-link-text"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel link edit"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setEditing(false)}
            >
              <XIcon />
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Save link"
              disabled={!normalizeLinkUrl(draftUrl)}
              onMouseDown={(event) => event.preventDefault()}
            >
              <CheckIcon />
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <a
            href={url}
            target={attributes.target ?? '_blank'}
            rel={attributes.rel ?? 'noopener noreferrer'}
            className="min-w-0 flex-1 truncate text-sm text-primary underline underline-offset-2 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {url}
          </a>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Edit link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Remove link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      )}
    </div>
  )
}
