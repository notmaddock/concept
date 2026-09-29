import { FORMAT_TEXT_COMMAND } from 'lexical'
import type { LexicalEditor, TextFormatType } from 'lexical'
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import type { FormatState, PositionRect } from './types'

type FormatConfig = {
  format: TextFormatType
  stateKey: keyof FormatState
  icon: LucideIcon
  label: string
}

const FORMAT_BUTTONS: FormatConfig[] = [
  { format: 'bold', stateKey: 'isBold', icon: Bold, label: 'bold' },
  { format: 'italic', stateKey: 'isItalic', icon: Italic, label: 'italic' },
  {
    format: 'underline',
    stateKey: 'isUnderline',
    icon: Underline,
    label: 'underline',
  },
  {
    format: 'strikethrough',
    stateKey: 'isStrikethrough',
    icon: Strikethrough,
    label: 'strikethrough',
  },
  { format: 'code', stateKey: 'isCode', icon: Code, label: 'code' },
]

export interface FloatingTextFormatToolbarProps {
  editor: LexicalEditor
  isOpen: boolean
  rangeRect: PositionRect | null
  formatState: FormatState
  onOpenChange: (open: boolean) => void
}

export function FloatingTextFormatToolbar({
  editor,
  isOpen,
  rangeRect,
  formatState,
  onOpenChange,
}: FloatingTextFormatToolbarProps) {
  const anchor = useMemo(() => {
    if (!rangeRect) return null
    return {
      getBoundingClientRect: () =>
        new DOMRect(
          rangeRect.left,
          rangeRect.top,
          Math.max(rangeRect.width, 1),
          Math.max(rangeRect.height, 1),
        ),
    }
  }, [rangeRect])

  return (
    <Popover
      open={isOpen && Boolean(rangeRect)}
      onOpenChange={onOpenChange}
      modal={false}
    >
      <PopoverContent
        anchor={anchor}
        side="top"
        sideOffset={8}
        align="center"
        initialFocus={false}
        finalFocus={false}
        role="toolbar"
        aria-label="Text formatting"
        className="w-auto p-1 rounded-sm border shadow-sm flex flex-row items-center gap-0.5 bg-popover"
      >
        {FORMAT_BUTTONS.map(({ format, stateKey, icon: Icon, label }) => {
          const isActive = formatState[stateKey]
          return (
            <Button
              key={format}
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-[calc(var(--radius-sm)-0.25rem)] text-muted-foreground hover:text-foreground',
                isActive && 'bg-accent text-accent-foreground',
              )}
              aria-label={`Format ${label}`}
              aria-pressed={isActive}
              onPointerDown={(e) => {
                e.preventDefault()
              }}
              onMouseDown={(e) => {
                e.preventDefault()
              }}
              onClick={() => {
                editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
              }}
            >
              <Icon className="size-4" />
            </Button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
