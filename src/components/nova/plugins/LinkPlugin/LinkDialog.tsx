import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export type LinkDialogValue = {
  url: string
  text: string
  hasLink: boolean
}

export function LinkDialog({
  open,
  value,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  value: LinkDialogValue
  onOpenChange: (open: boolean) => void
  onSubmit: (value: { url: string; text: string; remove: boolean }) => boolean
}) {
  const [url, setUrl] = useState(value.url)
  const [text, setText] = useState(value.text)

  useEffect(() => {
    if (!open) return
    setUrl(value.url)
    setText(value.text)
  }, [open, value])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {value.hasLink ? 'Edit link' : 'Insert link'}
          </DialogTitle>
          <DialogDescription>
            Only http, https, mailto, and tel links are allowed.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (onSubmit({ url, text, remove: false })) onOpenChange(false)
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="link-text">Text</Label>
            <Input
              id="link-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Link text"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            {value.hasLink && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (onSubmit({ url, text, remove: true })) onOpenChange(false)
                }}
              >
                Remove link
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
