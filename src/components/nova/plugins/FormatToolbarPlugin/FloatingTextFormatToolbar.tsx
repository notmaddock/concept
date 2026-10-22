import { useMemo, useState } from 'react'
import { TypographyControls, FormatIcon } from './TypographyControls'
import { useFormatActions } from '#/components/documents/navigation-menus/use-format-actions'
import { FormatSelect, toolbarActions } from './FormatOptions'
import type { LexicalEditor, TextFormatType } from 'lexical'
import {
  Bold,
  RemoveFormatting,
  Italic,
  Strikethrough,
  Underline,
  Subscript,
  Superscript,
  Ellipsis,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { ColorSelect } from './ColorSelect'
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
  {
    format: 'subscript',
    stateKey: 'isSubscript',
    icon: Subscript,
    label: 'subscript',
  },
  {
    format: 'superscript',
    stateKey: 'isSuperscript',
    icon: Superscript,
    label: 'superscript',
  },
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
  const editorRef = useMemo(() => ({ current: editor }), [editor])
  const { run, checked } = useFormatActions(
    editorRef,
    'selection-toolbar',
    toolbarActions,
  )
  const [panel, setPanel] = useState<'type' | null>(null)
  return (
    <Popover
      open={isOpen && Boolean(rangeRect)}
      onOpenChange={(open) => {
        if (!open) setPanel(null)
        onOpenChange(open)
      }}
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
        data-format-toolbar="true"
        role="toolbar"
        aria-label="Text formatting"
        className="max-w-[calc(100vw-1rem)] w-auto gap-0 rounded-2xl border p-1 shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-0.5">
          <div className="shrink-0 border-r pr-1 mr-0.5">
            <FormatSelect
              sectionId="paragraph-style"
              run={run}
              checked={checked}
            />
          </div>
          {FORMAT_BUTTONS.slice(0, 4).map(
            ({ format, stateKey, icon, label }) => (
              <FormatIcon
                key={format}
                actionId={`format-${format}`}
                label={label[0].toUpperCase() + label.slice(1)}
                icon={icon}
                active={formatState[stateKey]}
                onClick={() => void run({ kind: 'text', value: format })}
              />
            ),
          )}
          <FormatIcon
            label="Clear formatting"
            actionId="clear-formatting"
            icon={RemoveFormatting}
            onClick={() => void run({ kind: 'clear', value: 'text' })}
          />
          <ColorSelect sectionId="text-color" editor={editor} />
          <ColorSelect sectionId="highlight" editor={editor} />
          <FormatIcon
            label="More formatting"
            icon={Ellipsis}
            expanded={panel === 'type'}
            onClick={() => setPanel(panel ? null : 'type')}
          />
        </div>
        <div
          inert={!panel}
          aria-hidden={!panel}
          data-expanded={Boolean(panel)}
          className="h-0 overflow-hidden opacity-0 [interpolate-size:allow-keywords] transition-[height,opacity] duration-200 ease-out data-[expanded=true]:h-auto data-[expanded=true]:opacity-100 motion-reduce:transition-none"
        >
          <div className="mt-1 max-h-[min(50vh,24rem)] overflow-y-auto border-t p-1 pt-1.5">
            <TypographyControls editor={editor} run={run} checked={checked} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
