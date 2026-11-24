import { useEffect, useMemo, useState } from 'react'
import { useMediaQuery } from '#/hooks/use-media-query'

import { TypographyControls, FormatIcon } from './TypographyControls'
import { useFormatActions } from '#/components/documents/navigation-menus/use-format-actions'
import { FormatOptionsPopover, toolbarActions } from './FormatOptions'
import { MoreFormatting } from './MoreFormatting'
import type { LexicalEditor, TextFormatType } from 'lexical'
import { Bold, Italic, Underline, LinkIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { OPEN_LINK_DIALOG_COMMAND } from '../LinkPlugin/commands'
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
  const isMobile = useMediaQuery('(pointer: coarse)')
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
  const moreControl = <MoreFormatting run={run} checked={checked} />
  const primaryControls = (
    <div
      className={
        isMobile
          ? 'flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [&>*]:shrink-0'
          : 'flex min-w-0 flex-wrap items-center gap-0.5'
      }
      data-format-scroll={isMobile || undefined}
    >
      <div className="shrink-0 border-r pr-1 mr-0.5">
        <FormatOptionsPopover
          large={isMobile}
          sectionId="paragraph-style"
          run={run}
          checked={checked}
        />
      </div>
      {FORMAT_BUTTONS.map(({ format, stateKey, icon, label }) => (
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
        label="Link"
        actionId="format-link"
        icon={LinkIcon}
        active={formatState.isLink}
        onClick={() =>
          editor.dispatchCommand(OPEN_LINK_DIALOG_COMMAND, undefined)
        }
      />
      <TypographyControls
        editor={editor}
        run={run}
        checked={checked}
        large={isMobile}
      />
      <FormatOptionsPopover
        sectionId="alignment"
        run={run}
        checked={checked}
        large={isMobile}
      />
      <ColorSelect sectionId="text-color" editor={editor} />
      <ColorSelect sectionId="highlight" editor={editor} />
      {!isMobile && moreControl}
    </div>
  )
  const controls = isMobile ? (
    <div className="flex min-w-0 shrink-0 items-center gap-1">
      {primaryControls}
      <div className="shrink-0 border-l pl-1">{moreControl}</div>
    </div>
  ) : (
    primaryControls
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
        side={rangeRect && rangeRect.top < 48 ? 'bottom' : 'top'}
        sideOffset={8}
        align="center"
        initialFocus={false}
        finalFocus={false}
        data-format-toolbar="true"
        role="toolbar"
        aria-label="Text formatting"
        className="max-h-[max(0px,calc(var(--available-height)-2px))] max-w-[calc(100vw-1rem)] w-auto gap-0 rounded-2xl border p-1 shadow-lg"
      >
        {controls}
      </PopoverContent>
    </Popover>
  )
}
