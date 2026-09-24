import type {
  MenuOption,
  TypeaheadMenuPluginProps,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'

export type OnSelectOptionCallback<T extends MenuOption> =
  TypeaheadMenuPluginProps<T>['onSelectOption']
