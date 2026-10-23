import { $getSelectionStyleValueForProperty } from '@lexical/selection'
import { stepFontSize } from './font-size'
import { getDocumentActionShortcut } from '#/components/documents/navigation-menus/document-navigation-options'
import { ActionShortcut } from '#/components/documents/navigation-menus/ActionShortcut'
import { useEffect, useState } from 'react'
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical'
import type { LexicalEditor } from 'lexical'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  ListTodo,
  Code,
  Minus,
  Plus,
  Subscript,
  Superscript,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import type { FormatAction } from '#/components/documents/navigation-menus/format-options'
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import { FormatSelect } from './FormatOptions'

type Props = {
  editor: LexicalEditor
  active?: boolean
  run: (action: FormatAction) => void | Promise<void>
  checked: (action: FormatAction) => boolean | undefined
}

export function FormatIcon({
  label,
  icon: Icon,
  active,
  onClick,
  disabled,
  actionId,
  expanded,
}: {
  label: string
  icon: LucideIcon
  active?: boolean
  onClick: () => void
  actionId?: string
  expanded?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            aria-expanded={expanded}
            disabled={disabled}
            className="aria-pressed:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <ActionShortcut
          shortcut={actionId ? getDocumentActionShortcut(actionId) : undefined}
        />
      </TooltipContent>
    </Tooltip>
  )
}

function useTypography(editor: LexicalEditor, active: boolean) {
  const [value, setValue] = useState({ family: '', size: '' })
  useEffect(() => {
    if (!active) return
    const update = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || selection.isCollapsed()) {
          setValue({ family: '', size: '' })
          return
        }
        const nodes = selection
          .getNodes()
          .filter(
            (node) => $isTextNode(node) && node.getTextContent().length > 0,
          )
        if (!nodes.length) {
          setValue({ family: '', size: '' })
          return
        }
        const inlineFamily = $getSelectionStyleValueForProperty(
          selection,
          'font-family',
          '',
        )
        const inlineSize = $getSelectionStyleValueForProperty(
          selection,
          'font-size',
          '',
        )
        let family = inlineFamily
          ? inlineFamily
              .split(',')[0]
              .replace(/["']/g, '')
              .replace(' Variable', '')
          : ''
        const inlinePoints = inlineSize.endsWith('pt')
          ? parseFloat(inlineSize)
          : inlineSize.endsWith('px')
            ? parseFloat(inlineSize) * 0.75
            : null
        let size =
          inlinePoints === null
            ? ''
            : String(Math.round(inlinePoints * 100) / 100)
        if (!family || !size) {
          const firstElement = editor.getElementByKey(nodes[0].getKey())
          if (firstElement) {
            const computed = getComputedStyle(firstElement)
            if (!family) {
              family = computed.fontFamily
                .split(',')[0]
                .replace(/["']/g, '')
                .replace(' Variable', '')
            }
            if (!size) {
              size = String(
                Math.round(parseFloat(computed.fontSize) * 0.75 * 100) / 100,
              )
            }
          }
        }
        const nextValue = { family, size }
        setValue((current) =>
          current.family === nextValue.family && current.size === nextValue.size
            ? current
            : nextValue,
        )
      })
    update()
    return editor.registerUpdateListener(update)
  }, [editor, active])
  return value
}

export function TypographyControls({
  editor,
  run,
  checked,
  active = true,
}: Props) {
  const { family, size } = useTypography(editor, active)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const number = Number(draft)
    setDraft(null)
    if (
      draft.trim() &&
      Number.isFinite(number) &&
      number >= 1 &&
      number <= 200 &&
      number !== Number(size)
    )
      void run({ kind: 'style', property: 'font-size', value: `${number}pt` })
  }
  const step = (delta: number) => {
    setDraft(null)
    stepFontSize(editor, delta)
  }
  const icons = [
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    List,
    ListOrdered,
    ListTodo,
    Code,
    Subscript,
    Superscript,
  ]
  const actions = [
    ...formatSections
      .find((section) => section.id === 'alignment')!
      .choices.slice(0, 4),
    ...formatSections
      .find((section) => section.id === 'lists')!
      .choices.slice(0, 3),
    ...formatSections
      .find((section) => section.id === 'text')!
      .choices.slice(4),
  ]
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <FormatSelect
            sectionId="font-family"
            run={run}
            checked={checked}
            displayValue={family}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <FormatIcon
            label="Decrease font size"
            icon={Minus}
            onClick={() => step(-1)}
            disabled={Boolean(size) && Number(size) <= 1}
          />
          <Input
            type="number"
            aria-label="Font size (pt)"
            title="Font size (pt)"
            min={1}
            max={200}
            step="any"
            value={draft ?? size}
            placeholder="Mixed"
            className="h-7 w-14 px-1 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
                editor.focus()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setDraft(null)
                editor.focus()
              }
            }}
          />
          <FormatIcon
            label="Increase font size"
            icon={Plus}
            onClick={() => step(1)}
            disabled={Boolean(size) && Number(size) >= 200}
          />
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {actions.map(({ id, label, action }, index) => (
          <FormatIcon
            key={id}
            actionId={id}
            label={label}
            icon={icons[index]}
            active={Boolean(checked(action))}
            onClick={() =>
              run(
                action.kind === 'list' && checked(action)
                  ? { kind: 'list', value: 'none' }
                  : action,
              )
            }
          />
        ))}
      </div>
    </div>
  )
}
