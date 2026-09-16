import { Extension, ReactRenderer } from '@tiptap/react'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { SuggestionMenu } from '../sub/SuggestionMenu'
import type { SuggestionMenuRef } from '../sub/SuggestionMenu'
import { ALL_ITEMS } from './commands'
import type { SlashCommandItem } from './commands'

export type { SlashCommandItem } from './commands'

export interface SlashCommandOptions {
  suggestion: Partial<Omit<SuggestionOptions<SlashCommandItem>, 'editor'>>
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query }) =>
          ALL_ITEMS.filter((i) =>
            i.title.toLowerCase().includes(query.toLowerCase().trim()),
          ),
        render: () => {
          let component: ReactRenderer<SuggestionMenuRef> | null = null
          let unmount: (() => void) | null = null

          return {
            onStart: (props) => {
              component = new ReactRenderer(SuggestionMenu, {
                props,
                editor: props.editor,
              })

              unmount = props.mount(component.element)
            },

            onUpdate: (props) => {
              component?.updateProps(props)
            },

            onKeyDown: (props) => {
              if (props.event.key === 'Escape') return false
              return component?.ref?.onKeyDown(props) ?? false
            },

            onExit: () => {
              unmount?.()
              component?.destroy()
            },
          }
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
