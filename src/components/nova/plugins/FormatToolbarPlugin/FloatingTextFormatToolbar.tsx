import { FORMAT_TEXT_COMMAND } from 'lexical'
import type { LexicalEditor, TextFormatType } from 'lexical'
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
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
  return (
    <Popover
      open={isOpen && Boolean(rangeRect)}
      onOpenChange={onOpenChange}
      modal={false}
    >
      {rangeRect &&
        createPortal(
          <PopoverTrigger
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              opacity: 0,
              left: rangeRect.left,
              top: rangeRect.top,
              width: Math.max(rangeRect.width, 1),
              height: Math.max(rangeRect.height, 1),
            }}
          />,
          document.body,
        )}
      <PopoverContent
        side="top"
        sideOffset={8}
        align="center"
        initialFocus={false}
        finalFocus={false}
        role="toolbar"
        aria-label="Text formatting"
        className="w-auto p-1 border shadow-sm flex flex-row items-center gap-0.5 bg-popover"
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
                'text-muted-foreground hover:text-foreground',
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
