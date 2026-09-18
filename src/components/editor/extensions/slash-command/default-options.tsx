import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $insertList } from '@lexical/list'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/extension'
import { $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getSelection, $isRangeSelection } from 'lexical'
import type { ElementNode } from 'lexical'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Type,
} from 'lucide-react'
import type { SlashCommandConfig } from './types'
import { SlashCommandOption } from './types'

function setBlockType(createNode: () => ElementNode) {
  const selection = $getSelection()
  if ($isRangeSelection(selection)) {
    $setBlocksType(selection, createNode)
  }
}

export const defaultSlashCommands: SlashCommandConfig[] = [
  {
    title: 'Text',
    description: 'Plain text paragraph',
    Icon: Type,
    category: 'Basic blocks',
    keywords: ['p', 'paragraph', 'text', 'normal'],
    onSelect: () => {
      setBlockType(() => $createParagraphNode())
    },
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    Icon: Heading1,
    category: 'Basic blocks',
    keywords: ['h1', 'heading 1', 'large', 'title'],
    onSelect: () => {
      setBlockType(() => $createHeadingNode('h1'))
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    Icon: Heading2,
    category: 'Basic blocks',
    keywords: ['h2', 'heading 2', 'medium', 'subtitle'],
    onSelect: () => {
      setBlockType(() => $createHeadingNode('h2'))
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    Icon: Heading3,
    category: 'Basic blocks',
    keywords: ['h3', 'heading 3', 'small', 'subheading'],
    onSelect: () => {
      setBlockType(() => $createHeadingNode('h3'))
    },
  },
  {
    title: 'Quote',
    description: 'Capture a quote or callout block',
    Icon: Quote,
    category: 'Basic blocks',
    keywords: ['quote', 'blockquote', 'cite'],
    onSelect: () => {
      setBlockType(() => $createQuoteNode())
    },
  },
  {
    title: 'Bullet list',
    description: 'Simple bulleted list',
    Icon: List,
    category: 'Lists',
    keywords: ['ul', 'bullet', 'unordered', 'list'],
    onSelect: () => {
      $insertList('bullet')
    },
  },
  {
    title: 'Numbered list',
    description: 'Numbered ordered list',
    Icon: ListOrdered,
    category: 'Lists',
    keywords: ['ol', 'numbered', 'ordered', 'list'],
    onSelect: () => {
      $insertList('number')
    },
  },
  {
    title: 'Todo list',
    description: 'Checklist with interactive items',
    Icon: ListTodo,
    category: 'Lists',
    keywords: ['todo', 'task', 'check', 'checkbox', 'checklist'],
    onSelect: () => {
      $insertList('check')
    },
  },
  {
    title: 'Divider',
    description: 'Visual horizontal separator',
    Icon: Minus,
    category: 'Layout',
    keywords: ['hr', 'divider', 'horizontal rule', 'line', 'break'],
    onSelect: (editor) => {
      editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
    },
  },
]

export function createSlashCommandOptions(
  commands: SlashCommandConfig[],
): SlashCommandOption[] {
  return commands.map((cmd) => new SlashCommandOption(cmd.title, cmd))
}
