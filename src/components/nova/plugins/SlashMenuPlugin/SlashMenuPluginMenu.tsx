import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { BlockOption } from './options'
import { createPortal } from 'react-dom'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { useMemo } from 'react'

type SlashMenuRenderArgs = Parameters<MenuRenderFn<BlockOption>>

interface SlashMenuPluginMenuProps {
  anchorElementRef: SlashMenuRenderArgs[0]
  itemProps: SlashMenuRenderArgs[1]
  matchingString: SlashMenuRenderArgs[2]
}

export function SlashMenuPluginMenu({
  anchorElementRef,
  itemProps,
}: SlashMenuPluginMenuProps) {
  const {
    selectedIndex,
    selectOptionAndCleanUp,
    setHighlightedIndex,
    options,
  } = itemProps

  const groups = useMemo(() => {
    const map = new Map<string, BlockOption[]>()
    for (const option of options) {
      const bucket = map.get(option.category)
      if (bucket) {
        bucket.push(option)
      } else {
        map.set(option.category, [option])
      }
    }
    return Array.from(map.entries())
  }, [options])

  const selectedValue =
    selectedIndex !== null ? options[selectedIndex]?.key : undefined

  if (!anchorElementRef.current) return null

  return createPortal(
    <Command
      shouldFilter={false}
      value={selectedValue}
      onValueChange={(value) => {
        const index = options.findIndex((o) => o.key === value)
        if (index !== -1) setHighlightedIndex(index)
      }}
      className="min-w-64 min-h-48 max-h-128 rounded-sm border bg-popover shadow-sm animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
    >
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {groups.map(([category, groupOptions]) => (
          <CommandGroup key={category} heading={category}>
            {groupOptions.map((option) => (
              <CommandItem
                key={option.key}
                ref={option.setRefElement}
                value={option.key}
                onSelect={() => selectOptionAndCleanUp(option)}
              >
                {option.icon}
                {option.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>,
    anchorElementRef.current,
  )
}
