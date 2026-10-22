import { Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

const tones = [0.8, 0.6, 0.35, 0, -0.2, -0.4, -0.6]

export function ColorSwatch({
  label,
  value,
  color,
  highlight,
  currentColor,
  open,
  onOpenChange,
  onApply,
}: {
  label: string
  value: string
  color: string
  highlight: boolean
  currentColor: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (value: string) => void
}) {
  const channels = [1, 3, 5].map((index) =>
    parseInt(color.slice(index, index + 2), 16),
  )

  const matches = (rgb: number[]) => {
    const expected = highlight
      ? `rgba(${rgb.join(',')},0.18)`
      : `rgb(${rgb.join(',')})`
    return currentColor?.replace(/\s/g, '') === expected
  }
  const selected = matches(channels)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
      modal={false}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative aspect-square rounded-full border-0 p-0"
                  onMouseDown={(event) => event.preventDefault()}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onOpenChange(true)
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ContextMenu' ||
                      (event.shiftKey && event.key === 'F10')
                    ) {
                      event.preventDefault()
                      onOpenChange(true)
                    }
                  }}
                  onClick={() => onApply(value)}
                />
              }
              aria-label={label}
              aria-pressed={selected}
            />
          }
        >
          <span
            className="block size-5 shrink-0 rounded-full forced-color-adjust-none"
            style={{ backgroundColor: color }}
          />
          {selected && (
            <Check aria-hidden="true" className="absolute size-3 text-white" />
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        data-format-toolbar="true"
        aria-label={`${label} shades`}
        align="center"
        sideOffset={4}
        finalFocus={false}
        className="w-9 items-center gap-0.5 rounded-full p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
          )
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          event.preventDefault()
          const offset = event.key === 'ArrowDown' ? 1 : -1
          buttons[(index + offset + buttons.length) % buttons.length].focus()
        }}
      >
        {tones.map((tone, index) => {
          const shade = channels.map((channel) =>
            Math.round(
              tone >= 0
                ? channel + (255 - channel) * tone
                : channel * (1 + tone),
            ),
          )
          return (
            <Button
              key={tone}
              variant="ghost"
              size="icon-sm"
              className="relative rounded-full border-0 p-0"
              aria-label={`${label} shade ${index + 1}`}
              aria-pressed={matches(shade)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onApply(
                  highlight
                    ? `rgba(${shade.join(', ')}, 0.18)`
                    : `rgb(${shade.join(', ')})`,
                )
                onOpenChange(false)
              }}
            >
              <span
                className="block size-5 shrink-0 rounded-full forced-color-adjust-none"
                style={{ backgroundColor: `rgb(${shade.join(', ')})` }}
              />
              {matches(shade) && (
                <Check
                  aria-hidden="true"
                  className="absolute size-3 text-white drop-shadow-sm"
                />
              )}
            </Button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
