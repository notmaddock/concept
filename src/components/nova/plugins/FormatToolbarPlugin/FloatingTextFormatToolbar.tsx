import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '#/hooks/use-mobile'
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
  const isMobile = useIsMobile()
  const [viewport, setViewport] = useState({
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
  })
  useEffect(() => {
    if (!isMobile) return
    const update = () => {
      const visible = window.visualViewport
      setViewport({
        bottom: visible
          ? Math.max(0, window.innerHeight - visible.height - visible.offsetTop)
          : 0,
        left: visible?.offsetLeft ?? 0,
        width: visible?.width ?? window.innerWidth,
        height: visible?.height ?? window.innerHeight,
      })
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isMobile])
  const editorRef = useMemo(() => ({ current: editor }), [editor])
  const { run, checked } = useFormatActions(
    editorRef,
    'selection-toolbar',
    toolbarActions,
    isOpen,
  )
  const [panel, setPanel] = useState<'type' | null>(null)
  const [isPanelAnimating, setIsPanelAnimating] = useState(false)
  const controls = (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5">
        <div className="shrink-0 border-r pr-1 mr-0.5">
          <FormatSelect
            sectionId="paragraph-style"
            run={run}
            checked={checked}
          />
        </div>
        {FORMAT_BUTTONS.slice(0, 4).map(({ format, stateKey, icon, label }) => (
          <FormatIcon
            key={format}
            actionId={`format-${format}`}
            label={label[0].toUpperCase() + label.slice(1)}
            icon={icon}
            active={formatState[stateKey]}
            onClick={() => void run({ kind: 'text', value: format })}
          />
        ))}
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
          onClick={() => {
            setIsPanelAnimating(
              !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            )
            setPanel(panel ? null : 'type')
          }}
        />
      </div>
      <div
        inert={!panel}
        aria-hidden={!panel}
        data-expanded={Boolean(panel)}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === 'height'
          ) {
            setIsPanelAnimating(false)
          }
        }}
        style={{
          overflowY: isPanelAnimating || !panel ? 'hidden' : 'auto',
          scrollbarGutter: 'stable',
        }}
        className="min-h-0 h-0 max-h-[min(50vh,24rem)] overflow-x-hidden opacity-0 [interpolate-size:allow-keywords] transition-[height,opacity] duration-200 ease-out data-[expanded=true]:h-auto data-[expanded=true]:opacity-100 motion-reduce:transition-none"
      >
        <div className="mt-1 border-t p-1 pt-1.5">
          <TypographyControls
            editor={editor}
            run={run}
            checked={checked}
            active={isOpen && panel === 'type'}
          />
        </div>
      </div>
    </>
  )
  if (isMobile) {
    return isOpen && rangeRect
      ? createPortal(
          <div
            data-format-toolbar="true"
            data-mobile="true"
            role="toolbar"
            aria-label="Text formatting"
            style={{
              bottom: viewport.bottom,
              left: viewport.left,
              width: viewport.width || '100%',
              maxHeight: viewport.height ? viewport.height * 0.6 : '60dvh',
            }}
            className="fixed z-50 flex flex-col overflow-y-auto border-t bg-popover p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-lg [&_button]:min-h-11 [&_button]:min-w-11"
          >
            {controls}
          </div>,
          document.body,
        )
      : null
  }
  return (
    <Popover
      open={isOpen && Boolean(rangeRect)}
      onOpenChange={(open) => {
        if (!open) {
          setPanel(null)
          setIsPanelAnimating(false)
        }
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
        // Leave room for the positioner’s collision bias so expansion cannot trigger a flip.
        className="max-h-[max(0px,calc(var(--available-height)-2px))] max-w-[calc(100vw-1rem)] w-auto gap-0 rounded-2xl border p-1 shadow-lg"
      >
        {controls}
      </PopoverContent>
    </Popover>
  )
}
