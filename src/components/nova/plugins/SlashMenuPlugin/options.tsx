import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/extension'
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list'
import { MenuOption } from '@lexical/react/LexicalMenuOption'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getSelection, $isRangeSelection } from 'lexical'
import type { LexicalEditor } from 'lexical'
import {
  CodeIcon,
  Heading1Icon,
  ImageIcon,
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
import { INSERT_IMAGE_COMMAND } from '../../images/commands'
import { $insertCodeBlock } from '../CodePlugin/commands'

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
  TEXT: 'Text',
  LISTS: 'Lists',
  BLOCKS: 'Rich blocks',
  MEDIA: 'Media',
}

export function getBlockOptions(
  editor: LexicalEditor,
  imagesEnabled = false,
): BlockOption[] {
  return [
    new BlockOption('text', {
      title: 'Text',
      icon: <PilcrowIcon />,
      category: categories.TEXT,
      keywords: ['paragraph', 'text', 'p', 'normal'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createParagraphNode())
          }
        }),
    }),
    new BlockOption('heading-1', {
      title: 'Heading 1',
      category: categories.TEXT,
      icon: <Heading1Icon />,
      keywords: ['heading', 'title', 'h1'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode('h1'))
          }
        }),
    }),
    new BlockOption('heading-2', {
      title: 'Heading 2',
      icon: <Heading2Icon />,
      category: categories.TEXT,
      keywords: ['heading', 'subtitle', 'h2'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode('h2'))
          }
        }),
    }),
    new BlockOption('heading-3', {
      title: 'Heading 3',
      icon: <Heading3Icon />,
      category: categories.TEXT,
      keywords: ['heading', 'h3'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode('h3'))
          }
        }),
    }),
    new BlockOption('list-bullet', {
      title: 'Bulleted list',
      icon: <ListIcon />,
      category: categories.LISTS,
      keywords: ['bulleted list', 'unordered list', 'ul'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new BlockOption('list-numbered', {
      title: 'Numbered list',
      icon: <ListOrderedIcon />,
      category: categories.LISTS,
      keywords: ['numbered list', 'ordered list', 'ol'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new BlockOption('list-checked', {
      title: 'Check list',
      icon: <ListTodoIcon />,
      category: categories.LISTS,
      keywords: ['check list', 'checked list', 'todo'],
      onSelect: () => {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      },
    }),
    new BlockOption('quote', {
      title: 'Quote',
      icon: <QuoteIcon />,
      category: categories.BLOCKS,
      keywords: ['quote', 'blockquote'],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode())
          }
        }),
    }),
    new BlockOption('code', {
      title: 'Code block',
      icon: <CodeIcon />,
      category: categories.BLOCKS,
      keywords: ['code', 'codeblock', 'snippet', 'fence', 'pre'],
      onSelect: () => $insertCodeBlock(),
    }),
    new BlockOption('horizontal-rule', {
      title: 'Divider',
      icon: <MinusIcon />,
      category: categories.BLOCKS,
      keywords: ['hr', 'divider', 'horizontal rule', 'line', 'break'],
      onSelect: () =>
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    }),
    ...(imagesEnabled
      ? [
          new BlockOption('image', {
            title: 'Image',
            category: categories.MEDIA,
            icon: <ImageIcon />,
            keywords: ['image', 'photo', 'picture'],
            onSelect: () => {
              editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined)
            },
          }),
        ]
      : []),
  ]
}
