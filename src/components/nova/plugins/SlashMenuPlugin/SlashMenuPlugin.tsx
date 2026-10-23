import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { TriggerFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
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

export function useSlashTriggerMatch(): TriggerFn {
  const baseTriggerFunction = useBasicTypeaheadTriggerMatch('/', {
    allowWhitespace: true,
    minLength: 0,
  })

  return useCallback<TriggerFn>(
    (text, currentEditor) => {
      if (currentEditor.isComposing()) return null
      return baseTriggerFunction(text, currentEditor)
    },
    [baseTriggerFunction],
  )
}

export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)
  const triggerFunction = useSlashTriggerMatch()

  const options = useMemo<BlockOption[]>(
    () => filterBlockOptions(getBlockOptions(editor), queryString),
    [editor, queryString],
  )

  const onSelectOption = useCallback<OnSelectOptionCallback<BlockOption>>(
    (selectedOption, queryNode, closeMenu) => {
      if (editor.isComposing()) return
      $selectBlockOption(selectedOption, queryNode, closeMenu)
    },
    [editor],
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
