import {
  ClickAfterLastBlockExtension,
  SelectBlockExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { ListExtension } from '@lexical/list'
import { RichTextExtension } from '@lexical/rich-text'
import { defineExtension } from 'lexical'

export const editorExtension = defineExtension({
  name: '[root]',
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    ListExtension,
    TabIndentationExtension,
    ClickAfterLastBlockExtension,
    SelectBlockExtension,
  ],
})
