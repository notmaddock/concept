import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  mergeRegister,
} from 'lexical'
import type { TextFormatType } from 'lexical'
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react'
import { cn } from '#/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

export interface SelectionPopoverPluginProps {
  className?: string
}

interface FormatOption {
  format: TextFormatType
  label: string
  icon: React.ComponentType<{ className?: string }>
  hasSeparatorBefore?: boolean
}

const FORMAT_OPTIONS: FormatOption[] = [
  { format: 'bold', label: 'Bold', icon: Bold },
  { format: 'italic', label: 'Italic', icon: Italic },
  { format: 'underline', label: 'Underline', icon: Underline },
  { format: 'strikethrough', label: 'Strikethrough', icon: Strikethrough },
  {
    format: 'code',
    label: 'Inline Code',
    icon: Code,
    hasSeparatorBefore: true,
  },
]

/**
 * Returns true only when a fine pointing device (e.g. mouse, trackpad) is available.
 */
const subscribeFinePointer = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {}
  const mql = window.matchMedia('(pointer: fine)')
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

const getFinePointerSnapshot = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

const getFinePointerServerSnapshot = () => false

function useHasFinePointer(): boolean {
  return useSyncExternalStore(
    subscribeFinePointer,
    getFinePointerSnapshot,
    getFinePointerServerSnapshot,
  )
}

export function SelectionPopoverPlugin({
  className,
}: SelectionPopoverPluginProps) {
  const [editor] = useLexicalComposerContext()
  const hasFinePointer = useHasFinePointer()

  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>(
    {},
  )

  const isPointerDownRef = useRef(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const updatePopover = useCallback(() => {
    // If the user is actively dragging the pointer to select text, defer until pointerup
    if (isPointerDownRef.current) return

    editor.getEditorState().read(() => {
      const selection = $getSelection()
      const nativeSelection = window.getSelection()
      const rootElement = editor.getRootElement()

      if (
        !editor.isEditable() ||
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        selection.getTextContent().trim() === '' ||
        !nativeSelection ||
        nativeSelection.isCollapsed ||
        nativeSelection.rangeCount === 0 ||
        !rootElement ||
        !rootElement.contains(nativeSelection.anchorNode)
      ) {
        setPosition(null)
        return
      }

      const range = nativeSelection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      if (rect.width === 0 && rect.height === 0) {
        setPosition(null)
        return
      }

      // Hide if the selection is outside the visible area of the editor
      const rootRect = rootElement.getBoundingClientRect()
      if (
        rect.bottom < rootRect.top ||
        rect.top > rootRect.bottom ||
        rect.right < rootRect.left ||
        rect.left > rootRect.right
      ) {
        setPosition(null)
        return
      }

      // Calculate pill position (above selection, flipped below if near top of window or editor)
      const popoverHeight = 36
      const spacing = 8
      const topPlacement = rect.top - popoverHeight - spacing
      const minVisibleTop = Math.max(8, rootRect.top + 4)
      const top =
        topPlacement < minVisibleTop ? rect.bottom + spacing : topPlacement

      // Clamp horizontal center so popover remains comfortably within viewport
      const halfWidth = 85
      const minLeft = halfWidth + 12
      const maxLeft = window.innerWidth - halfWidth - 12
      const left = Math.min(
        Math.max(rect.left + rect.width / 2, minLeft),
        maxLeft,
      )

      setPosition({ top, left })
      setActiveFormats({
        bold: selection.hasFormat('bold'),
        italic: selection.hasFormat('italic'),
        underline: selection.hasFormat('underline'),
        strikethrough: selection.hasFormat('strikethrough'),
        code: selection.hasFormat('code'),
      })
    })
  }, [editor])

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      updatePopover()
    })
  }, [updatePopover])

  // Track pointer up/down for drag-selections and reposition on scroll/resize
  useEffect(() => {
    if (!hasFinePointer) return

    const handlePointerDown = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return
      isPointerDownRef.current = true
    }

    const handlePointerUp = () => {
      isPointerDownRef.current = false
      updatePopover()
    }

    const handleBlur = () => setPosition(null)

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('scroll', scheduleUpdate, true)
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('blur', handleBlur)

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('blur', handleBlur)
    }
  }, [hasFinePointer, scheduleUpdate, updatePopover])

  // Register Lexical listeners for editor changes and keyboard selection updates
  useEffect(() => {
    if (!hasFinePointer) return

    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => updatePopover())
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updatePopover()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          setPosition(null)
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, hasFinePointer, updatePopover])

  if (!hasFinePointer || !position || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label="Text formatting"
      className={cn(
        'fixed z-50 flex items-center gap-0.5 rounded-full border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur-md select-none',
        'animate-in fade-in-0 zoom-in-95 duration-150 ease-out',
        className,
      )}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {FORMAT_OPTIONS.map(
        ({ format, label, icon: Icon, hasSeparatorBefore }) => {
          const isActive = Boolean(activeFormats[format])
          return (
            <Fragment key={format}>
              {hasSeparatorBefore && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  className="mx-0.5 h-3.5 w-px bg-border/80 shrink-0"
                />
              )}
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  aria-label={label}
                  aria-pressed={isActive}
                  onMouseDown={(e) => {
                    // Prevent blurring the ContentEditable to preserve selection range
                    e.preventDefault()
                    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
                  }}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer',
                    'hover:bg-muted hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    isActive &&
                      'bg-accent text-accent-foreground font-semibold',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {label}
                </TooltipContent>
              </Tooltip>
            </Fragment>
          )
        },
      )}
    </div>,
    document.body,
  )
}
