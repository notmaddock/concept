import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useCallback, useMemo, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $selectBlockOption,
  filterBlockOptions,
  getBlockOptions,
} from './options'
import type { BlockOption } from './options'
import type { OnSelectOptionCallback } from './types'
import { SlashMenuPluginMenu } from './SlashMenuPluginMenu'

export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  const triggerFunction = useBasicTypeaheadTriggerMatch('/', {
    allowWhitespace: true,
    minLength: 0,
  })

  const options = useMemo<BlockOption[]>(
    () => filterBlockOptions(getBlockOptions(editor), queryString),
    [editor, queryString],
  )

  const onSelectOption = useCallback<OnSelectOptionCallback<BlockOption>>(
    (selectedOption, queryNode, closeMenu) => {
      $selectBlockOption(selectedOption, queryNode, closeMenu)
    },
    [],
  )

  return (
    <LexicalTypeaheadMenuPlugin<BlockOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      options={options}
      triggerFn={triggerFunction}
      menuRenderFn={(anchorElementRef, itemProps, matchingString) => (
        <SlashMenuPluginMenu
          anchorElementRef={anchorElementRef}
          itemProps={itemProps}
          matchingString={matchingString}
        />
      )}
    />
  )
}
