import { lazy, Suspense, useEffect, useState } from 'react'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  HISTORY_PUSH_TAG,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $patchStyleText } from '@lexical/selection'
import { Baseline, Highlighter, Check, Pipette } from 'lucide-react'
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
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import { cssRGB, elementBackground, readableColor } from './color-contrast'

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
  const palette = sectionId === 'highlight' ? highlightPalette : colorPalette
  const choices = [
    { label: sectionId === 'highlight' ? 'None' : 'Automatic', value: '' },
    ...palette,
  ]
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
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
        if (!elements.length || !root) return
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
        let match: (typeof palette)[number] | undefined
        if (sectionId === 'highlight') {
          const highlights = elements.map(
            (element) => getComputedStyle(element).backgroundColor,
          )
          const style = document.createElement('span').style
          match = palette.find(({ value }) => {
            style.backgroundColor = value
            return highlights.every((color) => color === style.backgroundColor)
          })
        } else {
          const backgrounds = new Map<HTMLElement, ReturnType<typeof cssRGB>>()
          const rootColor = getComputedStyle(root).color
          const colors = elements.map((element) => ({
            background: elementBackground(element, backgrounds),
            foreground: cssRGB(getComputedStyle(element).color),
          }))
          match = palette.find(({ value }) =>
            colors.every(({ foreground, background }) => {
              const expected = readableColor(
                cssRGB(value || rootColor, background),
                background,
              )
              return foreground.every(
                (channel, index) => channel === expected[index],
              )
            }),
          )
        }
        setSelectedColor(match?.value ?? null)
      })
    update()
    return editor.registerUpdateListener(update)
  }, [editor, palette, sectionId])
  const Icon = sectionId === 'text-color' ? Baseline : Highlighter
  const apply = (value: string) => {
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const property =
          sectionId === 'text-color' ? 'color' : 'background-color'
        $patchStyleText(selection, {
          color: (current, target) => {
            const element = !$isRangeSelection(target)
              ? (editor.getElementByKey(target.getKey()) ??
                editor.getElementByKey(target.getParent()?.getKey() ?? ''))
              : null
            const root = editor.getRootElement()!
            const style = document.createElement('span').style
            style.cssText =
              !$isRangeSelection(target) && 'getStyle' in target
                ? target.getStyle()
                : ''
            const background =
              property === 'background-color'
                ? value
                  ? cssRGB(
                      value,
                      elementBackground(element?.parentElement ?? root),
                    )
                  : elementBackground(element?.parentElement ?? root)
                : style.backgroundColor
                  ? cssRGB(
                      style.backgroundColor,
                      elementBackground(element?.parentElement ?? root),
                    )
                  : elementBackground(element ?? root)
            const foreground =
              property === 'color'
                ? value || getComputedStyle(root).color
                : current || getComputedStyle(element ?? root).color
            return `rgb(${readableColor(cssRGB(foreground, background), background).join(', ')})`
          },
          ...(property === 'background-color'
            ? { 'background-color': value || null }
            : {}),
        })
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
        if (!next) setCustomOpen(false)
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
        className="w-64 max-w-[calc(100vw-1rem)] gap-1 rounded-2xl p-2"
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
          className="grid grid-cols-8 justify-items-center gap-0.5"
          onKeyDown={(event) => {
            const offset = {
              ArrowRight: 1,
              ArrowLeft: -1,
              ArrowDown: 8,
              ArrowUp: -8,
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
            <Tooltip key={value}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    aria-pressed={selectedColor === value}
                    className="relative aspect-square rounded-full border-0 p-0"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      apply(value)
                      setOpen(false)
                    }}
                  />
                }
              >
                <span
                  className="block size-5 shrink-0 rounded-full forced-color-adjust-none"
                  style={{
                    backgroundColor:
                      sectionId === 'highlight'
                        ? colorPalette.find((color) => color.label === label)
                            ?.value
                        : value,
                  }}
                />
                {selectedColor === value && (
                  <Check
                    aria-hidden="true"
                    className="absolute size-3 text-white"
                  />
                )}
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen} modal={false}>
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
