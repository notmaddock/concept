import {
  defineExtension,
  HorizontalRuleExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import { CheckListExtension, ListExtension } from '@lexical/list'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { SlashCommandPlugin } from './SlashCommandPlugin'

/**
 * SlashCommandExtension registers required dependencies:
 * - RichTextExtension (HeadingNode, QuoteNode)
 * - ListExtension (ListNode, ListItemNode)
 * - CheckListExtension (Checklist keyboard/mouse interaction)
 * - TabIndentationExtension (Tab and Shift+Tab nesting for lists)
 * - HorizontalRuleExtension (HorizontalRuleNode)
 * - ReactExtension decorator (automatically renders SlashCommandPlugin)
 */
export const SlashCommandExtension = defineExtension({
  name: 'SlashCommandExtension',
  dependencies: [
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    TabIndentationExtension,
    HorizontalRuleExtension,
    [ReactExtension, { decorators: [SlashCommandPlugin] }],
  ],
})
