import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { exitSuggestion } from '@tiptap/suggestion'
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'
import { X } from 'lucide-react'
import type { SlashCommandItem } from '../extensions/commands'

export interface SuggestionMenuRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export const SuggestionMenu = forwardRef<
  SuggestionMenuRef,
  SuggestionProps<SlashCommandItem>
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelectedIndex(0), [props.items])

  useEffect(() => {
    if (selectedIndex < props.items.length) {
      const itemEl = listRef.current?.querySelector<HTMLElement>(
        `[data-index="${selectedIndex}"]`,
      )
      itemEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex, props.items.length])

  const closeMenu = () => {
    exitSuggestion(props.editor.view)
  }

  const select = (i: number) => {
    if (i >= 0 && i < props.items.length) {
      props.command(props.items[i])
    } else if (i === props.items.length) {
      closeMenu()
    }
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      const totalCount = props.items.length + 1
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (totalCount ? (i + 1) % totalCount : 0))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) =>
          totalCount ? (i - 1 + totalCount) % totalCount : 0,
        )
        return true
      }
      if (event.key === 'Enter') {
        select(selectedIndex)
        return true
      }
      return false
    },
  }))

  const activeValue =
    selectedIndex === props.items.length
      ? 'Close menu'
      : props.items[selectedIndex]?.title

  const sections = useMemo(() => {
    const groups = new Map<
      string,
      { item: SlashCommandItem; index: number }[]
    >()
    props.items.forEach((item, index) => {
      const list = groups.get(item.section)
      if (list) {
        list.push({ item, index })
      } else {
        groups.set(item.section, [{ item, index }])
      }
    })
    return groups
  }, [props.items])

  return (
    <Command
      className="w-56 z-20 rounded-md border shadow-md animate-in fade-in-0 zoom-in-95"
      value={activeValue}
      onValueChange={(value) => {
        if (value === 'Close menu') {
          setSelectedIndex(props.items.length)
          return
        }
        const i = props.items.findIndex((item) => item.title === value)
        if (i !== -1) setSelectedIndex(i)
      }}
    >
      {props.items.length > 0 && (
        <CommandList ref={listRef} className="scroll-smooth">
          {Array.from(sections.entries()).map(([section, items]) => (
            <CommandGroup key={section} heading={section}>
              {items.map(({ item, index }) => (
                <CommandItem
                  key={item.title}
                  value={item.title}
                  data-index={index}
                  className="rounded-sm"
                  onSelect={() => select(index)}
                >
                  {item.icon && <item.icon className="size-4 shrink-0" />}
                  <span>{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      )}
      <div
        className={
          props.items.length > 0 ? 'border-t border-border/50 p-1' : 'p-1'
        }
      >
        <CommandItem
          value="Close menu"
          className="rounded-sm"
          onSelect={closeMenu}
        >
          <X className="size-4 shrink-0" />
          <span>Close menu</span>
        </CommandItem>
      </div>
    </Command>
  )
})

SuggestionMenu.displayName = 'SuggestionMenu'
