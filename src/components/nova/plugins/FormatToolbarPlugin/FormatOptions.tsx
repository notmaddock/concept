import {
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Quote,
  List,
  ListOrdered,
  ListTodo,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import type { FormatAction } from '#/components/documents/navigation-menus/format-options'

const blockIcons: Record<string, LucideIcon> = {
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
}
function ChoiceIcon({ action }: { action?: FormatAction }) {
  const Icon =
    action && (action.kind === 'block' || action.kind === 'list')
      ? blockIcons[action.value]
      : undefined
  return Icon ? <Icon className="size-4 shrink-0" /> : null
}

export const toolbarActions = formatSections.flatMap((section) =>
  section.choices.map((choice) => choice.action),
)

type Props = {
  displayValue?: string
  sectionId: string
  run: (action: FormatAction) => void | Promise<void>
  checked: (action: FormatAction) => boolean | undefined
}

export function FormatSelect({ sectionId, run, checked, displayValue }: Props) {
  const section = formatSections.find((item) => item.id === sectionId)!
  const choices =
    sectionId === 'paragraph-style'
      ? [
          ...section.choices,
          ...formatSections
            .find((item) => item.id === 'lists')!
            .choices.filter(
              (choice) =>
                choice.action.kind === 'list' && choice.action.value !== 'none',
            ),
        ]
      : section.choices
  const selected = choices.find((choice) => checked(choice.action))
  return (
    <Select
      value={selected?.id ?? null}
      onValueChange={(value) => {
        const choice = choices.find((item) => item.id === value)
        if (choice) void run(choice.action)
      }}
    >
      <SelectTrigger
        aria-label={section.label}
        size="sm"
        className={
          sectionId === 'paragraph-style' ? 'w-auto px-2' : 'w-full min-w-0'
        }
      >
        <ChoiceIcon action={selected?.action} />
        <SelectValue
          className={sectionId === 'paragraph-style' ? 'min-w-max' : undefined}
          placeholder={section.label}
        >
          {displayValue || selected?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        data-format-toolbar="true"
        alignItemWithTrigger={false}
        className="min-w-48"
      >
        <SelectGroup>
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              <ChoiceIcon action={choice.action} />
              {choice.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
