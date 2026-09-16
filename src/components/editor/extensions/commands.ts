import type { ComponentType } from 'react'
import type { Editor, Range } from '@tiptap/react'
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Underline,
} from 'lucide-react'

export interface SlashCommandItem {
  title: string
  section: string
  icon?: ComponentType<{ className?: string }>
  command: (opts: { editor: Editor; range: Range }) => void
}

export const ALL_ITEMS: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    section: 'Headings',
    icon: Heading1,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 1 })
        .run(),
  },
  {
    title: 'Heading 2',
    section: 'Headings',
    icon: Heading2,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 2 })
        .run(),
  },
  {
    title: 'Heading 3',
    section: 'Headings',
    icon: Heading3,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 3 })
        .run(),
  },
  {
    title: 'Bold',
    section: 'Formatting',
    icon: Bold,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBold().run(),
  },
  {
    title: 'Italic',
    section: 'Formatting',
    icon: Italic,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleItalic().run(),
  },
  {
    title: 'Underline',
    section: 'Formatting',
    icon: Underline,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleUnderline().run(),
  },
  {
    title: 'Bullet List',
    section: 'Lists',
    icon: List,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    section: 'Lists',
    icon: ListOrdered,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
]
