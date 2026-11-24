import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useCallback, useMemo, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useDocumentMedia } from '../../media/document-media-context'
import { getBlockOptions } from './options'
import type { BlockOption } from './options'
import type { OnSelectOptionCallback } from './types'
import { SlashMenuPluginMenu } from './SlashMenuPluginMenu'

export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext()
  const media = useDocumentMedia()
  const [queryString, setQueryString] = useState<string | null>(null)

  const triggerFunction = useBasicTypeaheadTriggerMatch('/', {
    allowWhitespace: true,
    minLength: 0,
  })

  const mediaEnabled = Boolean(media)
  const baseOptions = useMemo<BlockOption[]>(
    () => getBlockOptions(editor, mediaEnabled),
    [editor, mediaEnabled],
  )

  const options = useMemo<BlockOption[]>(() => {
    if (!queryString) return baseOptions

    const query = queryString.toLowerCase()

    return baseOptions.filter(
      (o) =>
        o.title.toLowerCase().includes(query) ||
        o.keywords?.some((k) => k.toLowerCase().includes(query)),
    )
  }, [baseOptions, queryString])

  const onSelectOption = useCallback<OnSelectOptionCallback<BlockOption>>(
    (selectedOption, queryNode, closeMenu, _) => {
      editor.update(() => {
        if (queryNode !== null) {
          queryNode.remove()
        }

        selectedOption.onSelect()
        closeMenu()
      })
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
