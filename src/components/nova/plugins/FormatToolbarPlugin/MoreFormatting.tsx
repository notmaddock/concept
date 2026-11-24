import {
  ArrowDownToLine,
  CaseSensitive,
  Code,
  Ellipsis,
  IndentDecrease,
  IndentIncrease,
  Languages,
  List,
  ListEnd,
  ListStart,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
} from 'lucide-react'
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
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import { FormatOptionsPopover } from './FormatOptions'
import type { FormatControls } from './FormatOptions'
import { FormatIcon } from './TypographyControls'

const optionSections = [
  ['lists', List],
  ['line-spacing', ArrowDownToLine],
  ['space-before', ListStart],
  ['space-after', ListEnd],
  ['case', CaseSensitive],
  ['direction', Languages],
] as const
const advancedIcons = [
  Strikethrough,
  Code,
  Subscript,
  Superscript,
  IndentIncrease,
  IndentDecrease,
]
const advancedActions = [
  ...formatSections.find(({ id }) => id === 'text')!.choices.slice(3),
  ...formatSections.find(({ id }) => id === 'indent')!.choices,
]

export function MoreFormatting({ run, checked }: FormatControls) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="More formatting"
              onMouseDown={(event) => event.preventDefault()}
              render={<Button variant="ghost" size="icon-sm" />}
            />
          }
        >
          <Ellipsis />
        </TooltipTrigger>
        <TooltipContent>More formatting</TooltipContent>
      </Tooltip>
      <PopoverContent
        data-format-toolbar="true"
        finalFocus={false}
        aria-label="More formatting"
        align="end"
        className="w-auto max-w-[calc(100vw-1rem)] gap-1 rounded-xl p-1.5"
      >
        <div className="flex flex-wrap items-center gap-0.5">
          {optionSections.map(([id, icon]) => (
            <FormatOptionsPopover
              key={id}
              sectionId={id}
              icon={icon}
              run={run}
              checked={checked}
            />
          ))}
          <FormatOptionsPopover
            sectionId="reset"
            icon={RemoveFormatting}
            run={run}
            checked={checked}
          />
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border-t pt-1">
          {advancedActions.map(({ id, label, action }, index) => (
            <FormatIcon
              key={id}
              actionId={id}
              label={label}
              icon={advancedIcons[index]}
              active={checked(action)}
              onClick={() => void run(action)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
