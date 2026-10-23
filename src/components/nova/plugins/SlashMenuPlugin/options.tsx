import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/extension'
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list'
import { MenuOption } from '@lexical/react/LexicalMenuOption'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $copyBlockFormatIndent, $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getSelection, $isRangeSelection } from 'lexical'
import type { ElementNode, LexicalEditor } from 'lexical'
import { $getParagraphStyle, $setParagraphStyle } from '../../paragraph-format'
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
} from 'lucide-react'
import type { JSX } from 'react'

interface BlockOptionConfig {
  title: string
  category: string
  icon?: JSX.Element
  keywords?: string[]
  onSelect: () => void
}

export class BlockOption extends MenuOption {
  title: string
  category: string
  icon?: JSX.Element
  keywords?: string[]
  onSelect: () => void

  constructor(
    key: string,
    { title, category, icon, keywords, onSelect }: BlockOptionConfig,
  ) {
    super(key)
    this.title = title
    this.category = category
    this.icon = icon
    this.keywords = keywords
    this.onSelect = onSelect
  }
}

const categories = {
  BASIC_BLOCKS: 'Basic blocks',
  OTHER: 'Other',
}

function $copyParagraphFormat(previous: ElementNode, next: ElementNode) {
  $copyBlockFormatIndent(previous, next)
  next.setDirection(previous.getDirection())
  $setParagraphStyle(next, $getParagraphStyle(previous))
}

export function getBlockOptions(editor: LexicalEditor): BlockOption[] {
  return [
    new BlockOption('text', {
      title: 'Text',
      icon: <PilcrowIcon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['paragraph', 'text', 'p', 'normal'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(
              selection,
              () => $createParagraphNode(),
              $copyParagraphFormat,
            )
          }
        }),
    }),
    new BlockOption('heading-1', {
      title: 'Heading 1',
      category: categories.BASIC_BLOCKS,
      icon: <Heading1Icon />,
      keywords: ['heading', 'title', 'h1'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(
              selection,
              () => $createHeadingNode('h1'),
              $copyParagraphFormat,
            )
          }
        }),
    }),
    new BlockOption('heading-2', {
      title: 'Heading 2',
      icon: <Heading2Icon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['heading', 'subtitle', 'h2'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(
              selection,
              () => $createHeadingNode('h2'),
              $copyParagraphFormat,
            )
          }
        }),
    }),
    new BlockOption('heading-3', {
      title: 'Heading 3',
      icon: <Heading3Icon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['heading', 'h3'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(
              selection,
              () => $createHeadingNode('h3'),
              $copyParagraphFormat,
            )
          }
        }),
    }),
    new BlockOption('list-bullet', {
      title: 'Bulleted list',
      icon: <ListIcon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['bulleted list', 'unordered list', 'ul'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new BlockOption('list-numbered', {
      title: 'Numbered list',
      icon: <ListOrderedIcon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['numbered list', 'ordered list', 'ol'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new BlockOption('list-checked', {
      title: 'Check list',
      icon: <ListTodoIcon />,
      category: categories.BASIC_BLOCKS,
      keywords: ['check list', 'checked list', 'todo'],
      onSelect: () => {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      },
    }),
    new BlockOption('quote', {
      title: 'Quote',
      icon: <QuoteIcon />,
      category: categories.OTHER,
      keywords: ['quote', 'blockquote'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(
              selection,
              () => $createQuoteNode(),
              $copyParagraphFormat,
            )
          }
        }),
    }),
    new BlockOption('horizontal-rule', {
      title: 'Divider',
      icon: <MinusIcon />,
      category: categories.OTHER,
      keywords: ['hr', 'divider', 'horizontal rule', 'line', 'break'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    }),
  ]
}
