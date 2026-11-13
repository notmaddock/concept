import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { BlockOption } from './options'
import { createPortal } from 'react-dom'
import { Fragment, useLayoutEffect } from 'react'

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
  const [editor] = useLexicalComposerContext()
  const {
    selectedIndex,
    selectOptionAndCleanUp,
    setHighlightedIndex,
    options,
  } = itemProps

  useLayoutEffect(() => {
    const root = editor.getRootElement()
    if (!root) return

    // Lexical updates this on arrow keys, but not on hover or a query reset.
    if (selectedIndex !== null && options[selectedIndex]) {
      root.setAttribute(
        'aria-activedescendant',
        `typeahead-item-${selectedIndex}`,
      )
    } else {
      root.removeAttribute('aria-activedescendant')
    }
  }, [editor, options, selectedIndex])

  if (!anchorElementRef.current) return null

  return createPortal(
    // Lexical owns keyboard navigation and selection; cmdk would add a second owner.
    <div
      role="presentation"
      className="min-w-64 max-h-72 overflow-y-auto rounded-2xl border bg-popover p-1 text-popover-foreground shadow-sm animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.length === 0 && (
        <div className="py-6 text-center text-sm">No results found.</div>
      )}
      {options.map((option, index) => (
        <Fragment key={option.key}>
          {option.category !== options[index - 1]?.category && (
            <div
              role="presentation"
              className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {option.category}
            </div>
          )}
          <div
            id={`typeahead-item-${index}`}
            ref={option.setRefElement}
            role="option"
            aria-selected={selectedIndex === index}
            tabIndex={-1}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => selectOptionAndCleanUp(option)}
            className="relative flex min-h-7 cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-hidden select-none aria-selected:bg-muted aria-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
          >
            {option.icon}
            {option.title}
          </div>
        </Fragment>
      ))}
    </div>,
    anchorElementRef.current,
  )
}
