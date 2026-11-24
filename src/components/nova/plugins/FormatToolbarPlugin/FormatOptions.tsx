import { useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  CheckIcon,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import type { FormatAction } from '#/components/documents/navigation-menus/format-options'

const icons: Record<string, LucideIcon> = {
  paragraph: Pilcrow,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  quote: Quote,
  bullet: List,
  number: ListOrdered,
  check: ListTodo,
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
  start: AlignLeft,
  end: AlignRight,
}
function actionIcon(action: FormatAction) {
  if (
    action.kind === 'block' ||
    action.kind === 'align' ||
    action.kind === 'list'
  ) {
    return icons[action.value]
  }
  return undefined
}

export const toolbarActions = formatSections.flatMap((section) =>
  section.choices.map((choice) => choice.action),
)

export type FormatControls = {
  run: (action: FormatAction) => void | Promise<void>
  checked: (action: FormatAction) => boolean | undefined
}

const spacing = {
  'line-spacing': { property: 'line-height', min: 0.5, max: 5, suffix: '' },
  'space-before': { property: 'margin-top', min: 0, max: 200, suffix: 'pt' },
  'space-after': { property: 'margin-bottom', min: 0, max: 200, suffix: 'pt' },
} as const

function CustomSpacing({
  id,
  apply,
}: {
  id: keyof typeof spacing
  apply: (action: FormatAction) => void
}) {
  const { property, min, max, suffix } = spacing[id]
  return (
    <form
      className="mt-1 flex items-center gap-1.5 border-t pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        const raw = new FormData(event.currentTarget).get('value')
        const value = Number(raw)
        if (
          typeof raw === 'string' &&
          raw.trim() &&
          Number.isFinite(value) &&
          value >= min &&
          value <= max
        ) {
          apply({ kind: 'paragraph', property, value: `${value}${suffix}` })
        }
      }}
    >
      <Input
        type="number"
        name="value"
        min={min}
        max={max}
        step="any"
        placeholder={suffix ? 'Custom (pt)' : 'Custom'}
        aria-label={suffix ? 'Custom spacing in points' : 'Custom line spacing'}
        required
        className="h-7 min-w-0"
      />
      <Button type="submit" variant="secondary" size="sm">
        Apply
      </Button>
    </form>
  )
}

export function FormatOptionsPopover({
  sectionId,
  run,
  checked,
  icon,
  displayValue,
  large = false,
}: FormatControls & {
  sectionId: string
  icon?: LucideIcon
  displayValue?: string
  large?: boolean
}) {
  const section = formatSections.find((item) => item.id === sectionId)!
  const choices =
    sectionId === 'paragraph-style'
      ? [
          ...section.choices,
          ...formatSections.find((item) => item.id === 'lists')!.choices,
        ]
      : section.choices
  const selected = choices.find((choice) => checked(choice.action))
  const Icon = (selected && actionIcon(selected.action)) ?? icon ?? section.icon
  const [open, setOpen] = useState(false)
  const label = selected ? `${section.label}: ${selected.label}` : section.label

  function apply(action: FormatAction) {
    setOpen(false)
    void run(action)
  }

  const spacingId =
    sectionId === 'line-spacing' ||
    sectionId === 'space-before' ||
    sectionId === 'space-after'
      ? sectionId
      : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={label}
              onMouseDown={(event) => event.preventDefault()}
              render={
                <Button
                  variant="ghost"
                  size={large ? 'icon' : 'icon-sm'}
                  className={large ? 'size-11' : undefined}
                />
              }
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>
          {displayValue ? `${section.label}: ${displayValue}` : label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        data-format-toolbar="true"
        finalFocus={false}
        align="start"
        className="w-52 max-w-[calc(100vw-1rem)] gap-0.5 rounded-xl p-1.5"
        aria-label={section.label}
      >
        <PopoverTitle className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {section.label}
        </PopoverTitle>
        {choices.map(({ id, label: choiceLabel, action }) => {
          const ChoiceIcon = actionIcon(action)
          const active = selected?.id === id
          return (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              aria-pressed={active}
              className="justify-start aria-pressed:bg-accent"
              onClick={() => apply(action)}
            >
              {ChoiceIcon && <ChoiceIcon />}
              <span className="min-w-0 truncate">{choiceLabel}</span>
              {active && <CheckIcon className="ms-auto" />}
            </Button>
          )
        })}
        {spacingId && <CustomSpacing id={spacingId} apply={apply} />}
      </PopoverContent>
    </Popover>
  )
}
