import { useEffect, useRef, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import type { NavigationOption } from './navigation-menus/document-navigation-options'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Kbd } from '#/components/ui/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

export function DocumentActionSearch({
  enabled,
  options,
  onFocusEditor,
}: {
  enabled: boolean
  options: NavigationOption[]
  onFocusEditor: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const groups = [...new Set(options.map((option) => option.group))]
  const searchOpen = open && enabled
  const hasQuery = query.trim().length > 0

  function closeSearch(restoreFocus = false) {
    setOpen(false)
    setQuery('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        enabled &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        setOpen((previous) => !previous)
        setQuery('')
        if (searchOpen) triggerRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, searchOpen])

  useEffect(() => {
    if (!searchOpen) return

    inputRef.current?.focus()

    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [searchOpen])

  return (
    <div
      ref={containerRef}
      className="relative z-50 h-7 w-7 shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeSearch()
      }}
    >
      <Command
        label="Search menus and actions"
        loop
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeSearch(true)
          }
        }}
        className={`absolute left-0 top-0 h-auto overflow-visible rounded-2xl bg-transparent p-0 ${searchOpen ? 'w-72 max-w-[calc(100vw-2rem)]' : 'w-7'}`}
      >
        <div
          className={`group/search relative flex h-7 w-full items-center rounded-2xl ${searchOpen ? 'bg-popover text-popover-foreground shadow-sm ring-1 ring-foreground/10 dark:ring-foreground/15' : ''}`}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={triggerRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Search menus and actions"
                  aria-expanded={searchOpen}
                  onClick={() => {
                    setOpen(true)
                    inputRef.current?.focus()
                  }}
                  disabled={!enabled}
                  className="size-7 [&_svg]:size-3.5"
                />
              }
            >
              <SearchIcon />
            </TooltipTrigger>
            {!searchOpen && (
              <TooltipContent>
                Search <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
              </TooltipContent>
            )}
          </Tooltip>
          {searchOpen && (
            <>
              <div className="min-w-0 flex-1 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group-addon]]:hidden [&_[data-slot=input-group]]:h-7! [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent">
                <CommandInput
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  aria-label="Search menus and actions"
                  placeholder="Search menus and actions…"
                  className="h-7 min-w-0 px-0 text-sm placeholder:text-muted-foreground"
                />
              </div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Close search"
                onClick={() => closeSearch(true)}
                className="mr-0.5 opacity-0 transition-opacity group-hover/search:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <XIcon />
              </Button>
            </>
          )}
        </div>
        {searchOpen && (
          <CommandList
            className={
              hasQuery
                ? 'absolute left-0 top-8 w-full rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10'
                : 'hidden'
            }
          >
            {hasQuery && (
              <>
                <CommandEmpty className="px-3 py-4 text-xs text-muted-foreground">
                  No matching actions.
                </CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup key={group} heading={group} className="p-0">
                    {options
                      .filter((option) => option.group === group)
                      .map((option) => {
                        const Icon = option.icon
                        return (
                          <CommandItem
                            key={option.id}
                            value={option.id}
                            keywords={[
                              option.label,
                              option.group,
                              ...option.keywords,
                            ]}
                            disabled={option.disabled}
                            className="min-h-7 py-1 [&>svg:last-child]:hidden"
                            onSelect={() => {
                              closeSearch()
                              void Promise.resolve(option.onSelect()).then(
                                () => {
                                  if (option.focusAfterSelect === 'editor') {
                                    onFocusEditor()
                                  }
                                },
                              )
                            }}
                          >
                            <Icon className="text-muted-foreground" />
                            <span className="min-w-0 truncate">
                              {option.label}
                            </span>
                          </CommandItem>
                        )
                      })}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  )
}
