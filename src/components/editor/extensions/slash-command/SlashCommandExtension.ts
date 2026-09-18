import {
  defineExtension,
  HorizontalRuleExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import { CheckListExtension, ListExtension } from '@lexical/list'

/**
 * SlashCommandExtension registers required dependencies:
 * - RichTextExtension (HeadingNode, QuoteNode)
 * - ListExtension (ListNode, ListItemNode)
 * - CheckListExtension (Checklist keyboard/mouse interaction)
 * - TabIndentationExtension (Tab and Shift+Tab nesting for lists)
 * - HorizontalRuleExtension (HorizontalRuleNode)
 *
 * This guarantees that all default slash command nodes and commands are registered in the editor.
 */
export const SlashCommandExtension = defineExtension({
  name: 'SlashCommandExtension',
  dependencies: [
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    TabIndentationExtension,
    HorizontalRuleExtension,
  ],
})
