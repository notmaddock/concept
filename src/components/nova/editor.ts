import {
  AutoFocusExtension,
  ClickAfterLastBlockExtension,
  HorizontalRuleExtension,
  SelectBlockExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { CodeExtension, CodeIndentExtension, $isCodeNode } from '@lexical/code'
import { HistoryExtension } from '@lexical/history'
import { CheckListExtension, ListExtension } from '@lexical/list'
import {
  autoLinkEmailMatcher,
  autoLinkUrlMatcher,
  AutoLinkExtension,
  LinkExtension,
  LinkNode,
} from '@lexical/link'
import { RichTextExtension } from '@lexical/rich-text'
import { configExtension, defineExtension } from 'lexical'
import {
  $applyLinkPolicyToNode,
  normalizeLinkUrl,
} from '#/lib/documents/link-policy'
import { ImageNode } from './nodes/ImageNode'
import { PagesExtension } from './pages'
import { getInitialState } from './initial-state'
import { defaultEditorTheme } from './theme'
import { paragraphDOM } from './paragraph-format'

export const editorExtension = defineExtension({
  name: '[root]',
  nodes: [ImageNode],
  init(config) {
    config.dom = { ...config.dom, ...paragraphDOM }
  },
  register(editor) {
    return editor.registerNodeTransform(LinkNode, $applyLinkPolicyToNode)
  },
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    ListExtension,
    CheckListExtension,
    HorizontalRuleExtension,
    TabIndentationExtension,
    CodeExtension,
    CodeIndentExtension,
    configExtension(LinkExtension, {
      validateUrl: (url) => normalizeLinkUrl(url) !== null,
    }),
    configExtension(AutoLinkExtension, {
      matchers: [autoLinkUrlMatcher, autoLinkEmailMatcher],
      excludeParents: [$isCodeNode],
    }),
    ClickAfterLastBlockExtension,
    SelectBlockExtension,
    AutoFocusExtension,
    PagesExtension,
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
