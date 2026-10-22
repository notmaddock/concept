import {
  AutoFocusExtension,
  ClickAfterLastBlockExtension,
  HorizontalRuleExtension,
  SelectBlockExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { CheckListExtension, ListExtension } from '@lexical/list'
import { RichTextExtension } from '@lexical/rich-text'
import { defineExtension } from 'lexical'
import { getInitialState } from './initial-state'
import { defaultEditorTheme } from './theme'

export const editorExtension = defineExtension({
  name: '[root]',
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    ListExtension,
    CheckListExtension,
    HorizontalRuleExtension,
    TabIndentationExtension,
    ClickAfterLastBlockExtension,
    SelectBlockExtension,
    AutoFocusExtension,
  ],

  $initialEditorState: getInitialState,
  theme: defaultEditorTheme,
})

export const collaborativeEditorExtension = defineExtension({
  ...editorExtension,
  name: '[document]',
  dependencies: editorExtension.dependencies!.filter(
    (dependency) => dependency !== HistoryExtension,
  ),
  $initialEditorState: null,
})
