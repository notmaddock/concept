// SuggestionMenu.tsx
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
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'
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
    const itemEl = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    )
    itemEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  const select = (i: number) => {
    if (i >= 0 && i < props.items.length) {
      props.command(props.items[i])
    }
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) =>
          props.items.length ? (i + 1) % props.items.length : 0,
        )
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) =>
          props.items.length
            ? (i - 1 + props.items.length) % props.items.length
            : 0,
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

  const activeValue = props.items[selectedIndex]?.title

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
      className="w-64 rounded-md border shadow-md animate-in fade-in-0 zoom-in-95"
      value={activeValue}
      onValueChange={(value) => {
        const i = props.items.findIndex((item) => item.title === value)
        if (i !== -1) setSelectedIndex(i)
      }}
    >
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
    </Command>
  )
})

SuggestionMenu.displayName = 'SuggestionMenu'
