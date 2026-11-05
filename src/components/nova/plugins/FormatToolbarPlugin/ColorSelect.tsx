import { lazy, Suspense, useEffect, useState } from 'react'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  HISTORY_PUSH_TAG,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $patchStyleText } from '@lexical/selection'
import { Baseline, Highlighter, Pipette } from 'lucide-react'
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
import { colorPalette, highlightPalette } from './color-palette'
import { ColorSwatch } from './ColorSwatch'
import { formatSections } from '#/components/documents/navigation-menus/format-options'

const CustomColor = lazy(() =>
  import('./CustomColor').then((module) => ({ default: module.CustomColor })),
)

export function ColorSelect({
  sectionId,
  editor,
}: {
  sectionId: 'text-color' | 'highlight'
  editor: LexicalEditor
}) {
  const section = formatSections.find((item) => item.id === sectionId)!
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [shadeColor, setShadeColor] = useState<string | null>(null)
  const palette = sectionId === 'highlight' ? highlightPalette : colorPalette
  const choices = [
    { label: sectionId === 'highlight' ? 'None' : 'Automatic', value: '' },
    ...palette,
  ]
  const [currentColor, setCurrentColor] = useState<string | null>(null)
  useEffect(() => {
    const update = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const elements = selection
          .getNodes()
          .filter($isTextNode)
          .map((node) => editor.getElementByKey(node.getKey()))
          .filter((element): element is HTMLElement => element !== null)
        const root = editor.getRootElement()
        if (!elements.length || !root) {
          setCurrentColor(null)
          return
        }
        const current = elements.map((element) =>
          sectionId === 'highlight'
            ? element.style.backgroundColor
            : element.style.color,
        )
        setCurrentColor(
          current.every((value) => value === current[0])
            ? current[0] || null
            : null,
        )
      })
    update()
    return editor.registerUpdateListener(update)
  }, [editor, palette, sectionId])
  const Icon = sectionId === 'text-color' ? Baseline : Highlighter
  const apply = (value: string) => {
    // Focus before committing: restoring the DOM selection can synchronously fire focus events.
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const property =
          sectionId === 'text-color' ? 'color' : 'background-color'
        $patchStyleText(selection, { [property]: value || null })
      },
      { tag: HISTORY_PUSH_TAG },
    )
    editor.focus()
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setCustomOpen(false)
          setShadeColor(null)
        }
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
                  className="relative overflow-hidden"
                  style={
                    currentColor
                      ? {
                          backgroundColor: `color-mix(in oklab, ${currentColor} 18%, transparent)`,
                        }
                      : undefined
                  }
                />
              }
              aria-label={section.label}
            />
          }
        >
          <Icon className="relative size-4" />
          {currentColor && (
            <span
              aria-hidden="true"
              className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full"
              style={{ backgroundColor: currentColor }}
            />
          )}
        </TooltipTrigger>
        <TooltipContent>{section.label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        data-format-toolbar="true"
        aria-label={section.label}
        align="start"
        finalFocus={false}
        className="w-72 max-w-[calc(100vw-1rem)] gap-1 rounded-2xl p-2"
      >
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">{section.label}</span>
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              apply('')
              setOpen(false)
              setCustomOpen(false)
            }}
          >
            {choices[0].label}
          </Button>
        </div>
        <div
          role="group"
          aria-label={`${section.label} palette`}
          className="grid grid-cols-9 justify-items-center gap-0.5"
          onKeyDown={(event) => {
            const offset = {
              ArrowRight: 1,
              ArrowLeft: -1,
              ArrowDown: 9,
              ArrowUp: -9,
            }[event.key]
            if (offset === undefined) return
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button',
              ),
            ]
            const index = buttons.indexOf(event.target as HTMLButtonElement)
            if (index < 0) return
            event.preventDefault()
            buttons[(index + offset + buttons.length) % buttons.length].focus()
          }}
        >
          {palette.map(({ label, value }) => (
            <ColorSwatch
              key={value}
              label={label}
              value={value}
              color={colorPalette.find((color) => color.label === label)!.value}
              highlight={sectionId === 'highlight'}
              currentColor={currentColor}
              open={shadeColor === value}
              onOpenChange={(next) => {
                setShadeColor((current) =>
                  next ? value : current === value ? null : current,
                )
                if (next) setCustomOpen(false)
              }}
              onApply={(color) => {
                apply(color)
                setOpen(false)
                setShadeColor(null)
              }}
            />
          ))}
          <Popover
            open={customOpen}
            onOpenChange={(next) => {
              setCustomOpen(next)
              if (next) setShadeColor(null)
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
                        className="rounded-full"
                      />
                    }
                    aria-label="Custom color"
                  />
                }
              >
                <Pipette className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Custom color</TooltipContent>
            </Tooltip>
            <PopoverContent
              data-format-toolbar="true"
              aria-label="Custom color"
              side="right"
              align="start"
              finalFocus={false}
              className="w-72 max-w-[calc(100vw-1rem)] rounded-2xl p-3"
            >
              {customOpen && (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-label="Loading custom color"
                      className="h-48"
                    />
                  }
                >
                  <CustomColor
                    key={currentColor ?? 'automatic'}
                    initialColor={currentColor}
                    onApply={(value) => {
                      apply(value)
                      setCustomOpen(false)
                      setOpen(false)
                    }}
                  />
                </Suspense>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </PopoverContent>
    </Popover>
  )
}
