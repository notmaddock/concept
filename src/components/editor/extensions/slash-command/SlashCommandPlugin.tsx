import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import type { LexicalEditor, TextNode } from 'lexical'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { cn } from '#/lib/utils'
import type { SlashCommandConfig, SlashCommandOption } from './types'
import {
  createSlashCommandOptions,
  defaultSlashCommands,
} from './default-options'

export interface SlashCommandPluginProps {
  commands?: SlashCommandConfig[]
  trigger?: string
  placeholder?: string
  className?: string
}

interface SlashCommandMenuProps {
  anchorElementRef: { current: HTMLElement | null }
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: SlashCommandOption) => void
  setHighlightedIndex: (index: number) => void
  orderedOptions: SlashCommandOption[]
  displayGroups: {
    category: string
    items: { option: SlashCommandOption; index: number }[]
  }[]
  matchingString: string
  trigger: string
  placeholder?: string
  className?: string
}

function SlashCommandMenu({
  anchorElementRef,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
  orderedOptions,
  displayGroups,
  matchingString,
  trigger,
  placeholder = 'Type a command',
  className,
}: SlashCommandMenuProps) {
  // Only play the opening entrance animation once on initial mount,
  // preventing re-animation pops on subsequent keystrokes as the query changes
  const [isEntering, setIsEntering] = useState(true)
  const ghostChipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsEntering(false)
    }, 160)
    return () => clearTimeout(timer)
  }, [])

  // Inherit active font metrics (fontFamily, fontSize, lineHeight, etc.) from the block element
  // and compensate for anchor element clamping so the chip remains perfectly locked to the slash
  useLayoutEffect(() => {
    const updatePositionAndStyles = () => {
      if (!ghostChipRef.current) return
      const sel = window.getSelection()
      if (!sel || !sel.anchorNode) return

      const parent =
        sel.anchorNode.nodeType === Node.ELEMENT_NODE
          ? (sel.anchorNode as HTMLElement)
          : sel.anchorNode.parentElement
      if (parent) {
        const computed = window.getComputedStyle(parent)
        const chip = ghostChipRef.current
        chip.style.fontFamily = computed.fontFamily
        chip.style.fontSize = computed.fontSize
        chip.style.fontWeight = computed.fontWeight
        chip.style.letterSpacing = computed.letterSpacing
        chip.style.lineHeight = computed.lineHeight
      }

      if (anchorElementRef.current) {
        try {
          const range = document.createRange()
          if (sel.anchorNode.nodeType === Node.TEXT_NODE) {
            const offset = sel.anchorOffset
            const matchLen = trigger.length + matchingString.length
            const start = Math.max(0, offset - matchLen)
            range.setStart(sel.anchorNode, start)
            range.setEnd(
              sel.anchorNode,
              Math.min((sel.anchorNode as Text).length, start + trigger.length),
            )
          } else {
            range.selectNodeContents(sel.anchorNode)
          }
          const triggerRect = range.getBoundingClientRect()
          const anchorRect = anchorElementRef.current.getBoundingClientRect()
          const deltaX = triggerRect.left - anchorRect.left
          ghostChipRef.current.style.transform =
            Math.abs(deltaX) > 0.5 ? `translateX(${deltaX}px)` : ''
        } catch {
          ghostChipRef.current.style.transform = ''
        }
      }
    }

    updatePositionAndStyles()

    const anchor = anchorElementRef.current
    if (!anchor) return

    const observer = new MutationObserver(() => {
      updatePositionAndStyles()
    })

    observer.observe(anchor, {
      attributes: true,
      attributeFilter: ['style'],
    })

    window.addEventListener('resize', updatePositionAndStyles)
    window.addEventListener('scroll', updatePositionAndStyles, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePositionAndStyles)
      window.removeEventListener('scroll', updatePositionAndStyles, true)
    }
  }, [anchorElementRef, matchingString, trigger])

  if (!anchorElementRef.current) return null

  return createPortal(
    <>
      {/* 1. Command Menu Popover (must remain firstChild for Lexical viewport boundary math) */}
      <div
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          'absolute top-0 left-0 z-50 w-64',
          isEntering &&
            'animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 ease-out',
          className,
        )}
      >
        <Command
          shouldFilter={false}
          value={orderedOptions[selectedIndex ?? -1]?.key}
          className="border border-border/80 bg-popover/95 text-popover-foreground shadow-lg rounded-md! overflow-hidden p-0.5 backdrop-blur-md"
        >
          <CommandList className="max-h-80 overflow-y-auto scroll-py-1 pr-0.5">
            {orderedOptions.length === 0 ? (
              <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                No matching commands
              </CommandEmpty>
            ) : (
              displayGroups.map(({ category, items }) => (
                <CommandGroup
                  key={category}
                  heading={category}
                  className="p-0.5 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-[11px]"
                >
                  {items.map(({ option, index }) => {
                    const Icon = option.Icon
                    return (
                      <CommandItem
                        key={option.key}
                        id={`typeahead-item-${index}`}
                        role="option"
                        value={option.key}
                        ref={(el) => option.setRefElement(el)}
                        data-selected={selectedIndex === index}
                        className={cn(
                          'cursor-pointer flex items-center gap-2 px-2 py-1.5 rounded-sm! text-sm',
                          selectedIndex === index &&
                            'bg-muted text-foreground font-medium',
                        )}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onSelect={() => selectOptionAndCleanUp(option)}
                      >
                        {Icon && (
                          <Icon className="size-4 shrink-0 text-muted-foreground group-data-selected/command-item:text-foreground" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-xs leading-none truncate">
                            {option.title}
                          </span>
                          {option.description && (
                            <span className="text-[11px] text-muted-foreground mt-0.5 truncate leading-tight font-normal">
                              {option.description}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </div>

      {/* 2. Suggestion chip around the slash query with Notion-style ghost placeholder */}
      <div
        ref={ghostChipRef}
        className="pointer-events-none absolute bottom-[calc(100%+3px)] -left-1.5 flex h-full items-center whitespace-nowrap rounded-[5px] border border-border/80 bg-muted/50 px-1.5 text-foreground select-none"
      >
        <span className="invisible">
          {trigger}
          {matchingString}
        </span>
        {(!matchingString || matchingString.length === 0) && (
          <span className="ml-[0.6ch] text-[0.82em] font-normal text-muted-foreground/60 tracking-normal">
            {placeholder}
          </span>
        )}
      </div>
    </>,
    anchorElementRef.current,
  )
}

export function SlashCommandPlugin({
  commands = defaultSlashCommands,
  trigger = '/',
  placeholder = 'Type a command',
  className,
}: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  // Track whether the slash session is active (menu is open and user is typing the query)
  const isTriggerActiveRef = useRef(false)
  // Track whether the trigger key was specifically pressed to open the menu
  const triggerJustPressedRef = useRef(false)

  const allOptions = useMemo(
    () => createSlashCommandOptions(commands),
    [commands],
  )

  // Register keyboard and input listeners to detect when the trigger key is entered
  useEffect(() => {
    const removeKeyDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key === trigger
        ) {
          triggerJustPressedRef.current = true
        } else if (event.key === 'Escape') {
          isTriggerActiveRef.current = false
          triggerJustPressedRef.current = false
        } else {
          triggerJustPressedRef.current = false
        }
        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        isTriggerActiveRef.current = false
        triggerJustPressedRef.current = false
        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    const handleBeforeInput = (e: InputEvent) => {
      if (e.data === trigger) {
        triggerJustPressedRef.current = true
      }
    }

    const removeRootListener = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        prevRootElement?.removeEventListener('beforeinput', handleBeforeInput)
        rootElement?.addEventListener('beforeinput', handleBeforeInput)
      },
    )

    return () => {
      removeKeyDown()
      removeEscape()
      removeRootListener()
      editor
        .getRootElement()
        ?.removeEventListener('beforeinput', handleBeforeInput)
    }
  }, [editor, trigger])

  // Allow whitespace in query so searches like "heading 1" or "bullet list" work seamlessly
  const baseCheckForTriggerMatch = useBasicTypeaheadTriggerMatch(trigger, {
    minLength: 0,
    allowWhitespace: true,
  })

  // Only open the menu as a result of the trigger key being pressed, while allowing whitespace in active query
  const checkForTriggerMatch = useCallback(
    (text: string, currentEditor: LexicalEditor) => {
      const match = baseCheckForTriggerMatch(text, currentEditor)
      if (match === null) {
        isTriggerActiveRef.current = false
        triggerJustPressedRef.current = false
        return null
      }

      // If already active, keep matching as user types query (including whitespace)
      if (isTriggerActiveRef.current) {
        return match
      }

      // If not active, only open if the trigger key was specifically pressed
      if (triggerJustPressedRef.current) {
        isTriggerActiveRef.current = true
        triggerJustPressedRef.current = false
        return match
      }

      return null
    },
    [baseCheckForTriggerMatch],
  )

  // Filter matching options based on multi-word query tokens
  const matchingOptions = useMemo(() => {
    if (!queryString) return allOptions
    const trimmed = queryString.toLowerCase().trim()
    if (!trimmed) return allOptions
    const tokens = trimmed.split(/\s+/).filter(Boolean)

    return allOptions.filter((option) => {
      const fullSearchableText = [
        option.title.toLowerCase(),
        option.description?.toLowerCase() ?? '',
        ...option.keywords.map((k) => k.toLowerCase()),
      ].join(' ')

      return tokens.every((token) => fullSearchableText.includes(token))
    })
  }, [allOptions, queryString])

  // Group into categories in order, assigning strictly sequential indices
  const displayGroups = useMemo(() => {
    const groups = new Map<string, SlashCommandOption[]>()
    for (const option of matchingOptions) {
      const list = groups.get(option.category)
      if (list) {
        list.push(option)
      } else {
        groups.set(option.category, [option])
      }
    }

    let globalIndex = 0
    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      items: items.map((option) => ({
        option,
        index: globalIndex++,
      })),
    }))
  }, [matchingOptions])

  // Flatten in the exact DOM visual order so keyboard navigation strictly matches the rendered UI
  const orderedOptions = useMemo(() => {
    return displayGroups.flatMap((group) =>
      group.items.map((item) => item.option),
    )
  }, [displayGroups])

  const onOpen = useCallback(() => {
    isTriggerActiveRef.current = true
  }, [])

  const onClose = useCallback(() => {
    isTriggerActiveRef.current = false
    triggerJustPressedRef.current = false
  }, [])

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      isTriggerActiveRef.current = false
      triggerJustPressedRef.current = false
      nodeToRemove?.remove()
      selectedOption.run(editor)
      closeMenu()
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      onOpen={onOpen}
      onClose={onClose}
      triggerFn={checkForTriggerMatch}
      options={orderedOptions}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
        matchingString,
      ) => (
        <SlashCommandMenu
          anchorElementRef={anchorElementRef}
          selectedIndex={selectedIndex}
          selectOptionAndCleanUp={selectOptionAndCleanUp}
          setHighlightedIndex={setHighlightedIndex}
          orderedOptions={orderedOptions}
          displayGroups={displayGroups}
          matchingString={matchingString}
          trigger={trigger}
          placeholder={placeholder}
          className={className}
        />
      )}
    />
  )
}
