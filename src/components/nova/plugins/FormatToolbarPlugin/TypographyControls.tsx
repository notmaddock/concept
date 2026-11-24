import { stepFontSize } from './font-size'
import { getDocumentActionShortcut } from '#/components/documents/navigation-menus/document-navigation-options'
import { ActionShortcut } from '#/components/documents/navigation-menus/ActionShortcut'
import { useEffect, useState } from 'react'
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { Minus, Plus, TypeIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import type { FormatAction } from '#/components/documents/navigation-menus/format-options'
import { FormatOptionsPopover } from './FormatOptions'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'

type Props = {
  editor: LexicalEditor
  large?: boolean
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

function useTypography(editor: LexicalEditor) {
  const [value, setValue] = useState({ family: '', size: '' })
  useEffect(() => {
    const update = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const nodes = selection
          .getNodes()
          .filter(
            (node) => $isTextNode(node) && node.getTextContent().length > 0,
          )
        const styles = nodes
          .map((node) => editor.getElementByKey(node.getKey()))
          .filter((element): element is HTMLElement => element !== null)
          .map((element) => getComputedStyle(element))
        if (!styles.length) {
          setValue({ family: '', size: '' })
          return
        }
        const families = new Set(styles.map((style) => style.fontFamily))
        const sizes = new Set(
          styles.map((style) =>
            String(Math.round(parseFloat(style.fontSize) * 0.75 * 100) / 100),
          ),
        )
        const nextValue = {
          family:
            families.size === 1
              ? styles[0].fontFamily
                  .split(',')[0]
                  .replace(/["']/g, '')
                  .replace(' Variable', '')
              : 'Mixed fonts',
          size: sizes.size === 1 ? [...sizes][0] : '',
        }
        setValue((current) =>
          current.family === nextValue.family && current.size === nextValue.size
            ? current
            : nextValue,
        )
      })
    update()
    return editor.registerUpdateListener(update)
  }, [editor])
  return value
}

export function TypographyControls({
  editor,
  run,
  checked,
  large = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const { family, size } = useTypography(editor)
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
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="Typography"
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
          <TypeIcon />
        </TooltipTrigger>
        <TooltipContent>Typography</TooltipContent>
      </Tooltip>
      <PopoverContent
        data-format-toolbar="true"
        finalFocus={false}
        align="start"
        aria-label="Typography"
        className="w-56 gap-1 rounded-xl p-2"
      >
        <PopoverTitle className="ps-1 text-xs font-medium text-muted-foreground">
          Typography
        </PopoverTitle>
        <div className="flex items-center gap-1">
          <FormatOptionsPopover
            sectionId="font-family"
            run={run}
            checked={checked}
            displayValue={family}
          />
          {family && (
            <span className="min-w-0 flex-1 truncate text-xs" title={family}>
              {family}
            </span>
          )}
          <div className="ms-auto flex items-center gap-0.5">
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
              className="h-7 w-13 px-1 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
      </PopoverContent>
    </Popover>
  )
}
