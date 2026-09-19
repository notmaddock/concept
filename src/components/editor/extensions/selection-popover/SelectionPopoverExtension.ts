import { defineExtension } from '@lexical/extension'
import { RichTextExtension } from '@lexical/rich-text'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { SelectionPopoverPlugin } from './SelectionPopoverPlugin'

/**
 * SelectionPopoverExtension registers dependencies required for selection-based text formatting:
 * - RichTextExtension (provides FORMAT_TEXT_COMMAND and rich text nodes)
 * - ReactExtension decorator (automatically renders SelectionPopoverPlugin)
 */
export const SelectionPopoverExtension = defineExtension({
  name: 'SelectionPopoverExtension',
  dependencies: [
    RichTextExtension,
    [ReactExtension, { decorators: [SelectionPopoverPlugin] }],
  ],
})
