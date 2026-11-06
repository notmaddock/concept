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
import { ImageNode } from './nodes/ImageNode'
import { getInitialState } from './initial-state'
import { defaultEditorTheme } from './theme'
import { paragraphDOM } from './paragraph-format'

export const editorExtension = defineExtension({
  name: '[root]',
  nodes: [ImageNode],
  init(config) {
    config.dom = { ...config.dom, ...paragraphDOM }
  },
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
