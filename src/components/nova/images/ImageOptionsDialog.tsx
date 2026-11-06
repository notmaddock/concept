import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  imageDimensionLimit,
  imageMinimumDisplayWidth,
} from '#/lib/documents/image-schema'
import type { ImageSource } from '#/lib/documents/image-schema'
import type { ImageNode } from '../nodes/ImageNode'

export function ImageOptionsDialog({
  open,
  onOpenChange,
  source,
  altText,
  displayWidth,
  byteLength,
  canEdit,
  mutate,
  onReplace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: ImageSource
  altText: string
  displayWidth: number | null
  byteLength: number | undefined
  canEdit: boolean
  mutate: (change: (node: ImageNode) => void) => void
  onReplace: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Image Options</DialogTitle>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Alt text
            <Input
              key={altText}
              aria-label="Image alt text"
              defaultValue={altText}
              onBlur={(event) => {
                const value = event.target.value
                if (value !== altText) mutate((node) => node.setAltText(value))
              }}
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="grid flex-1 gap-2 text-sm font-medium">
              Width (px)
              <Input
                key={displayWidth}
                aria-label="Image width"
                type="number"
                min={imageMinimumDisplayWidth}
                max={imageDimensionLimit}
                step="any"
                defaultValue={Math.round(displayWidth ?? source.intrinsicWidth)}
                onBlur={(event) => {
                  const width = event.target.valueAsNumber
                  if (
                    Number.isFinite(width) &&
                    width >= imageMinimumDisplayWidth &&
                    width <= imageDimensionLimit
                  ) {
                    if (width !== (displayWidth ?? source.intrinsicWidth))
                      mutate((node) => node.setDisplayWidth(width))
                  } else {
                    event.target.value = String(
                      Math.round(displayWidth ?? source.intrinsicWidth),
                    )
                  }
                }}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => mutate((node) => node.setDisplayWidth(null))}
            >
              Natural size
            </Button>
          </div>
        </fieldset>
        <dl className="grid gap-3 rounded-xl bg-muted/50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Dimensions</dt>
            <dd>
              {source.intrinsicWidth} × {source.intrinsicHeight} px
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">File size</dt>
            <dd>
              {byteLength === undefined
                ? 'Unavailable'
                : `${byteLength.toLocaleString()} bytes`}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="select-text break-all font-mono text-xs">
              {source.assetId.slice('sha256:'.length)}
            </dd>
          </div>
        </dl>
        <DialogFooter>
          {canEdit && (
            <>
              <Button
                variant="destructive"
                onClick={() => {
                  mutate((node) => node.remove())
                  onOpenChange(false)
                }}
              >
                Delete image
              </Button>
              <Button variant="outline" onClick={onReplace}>
                Replace image
              </Button>
            </>
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
