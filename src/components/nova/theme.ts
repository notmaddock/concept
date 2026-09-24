import type { EditorThemeClasses } from 'lexical'

export const defaultEditorTheme: EditorThemeClasses = {
  paragraph: 'mb-2 leading-relaxed',

  heading: {
    h1: 'text-3xl font-bold tracking-tight mb-4',
    h2: 'text-2xl font-semibold tracking-tight mb-3',
    h3: 'text-xl font-semibold mb-2',
  },

  quote: 'border-l-2 border-primary/60 pl-4 italic text-muted-foreground my-3',

  hr: 'my-4 border-t border-border cursor-pointer',
  hrSelected: 'outline-2 outline-primary ring-2 ring-primary',

  list: {
    ul: 'list-disc list-inside mb-2',
    ol: 'list-decimal list-inside mb-2',
    checklist: 'list-none! pl-0! ml-1 my-2 space-y-1.5 [&_ul]:ml-6 [&_ul]:my-1',
    listitem: 'ml-4',
    listitemChecked: 'editor-checklist-item-checked',
    listitemUnchecked: 'editor-checklist-item-unchecked',
    nested: {
      list: 'my-1',
      listitem: 'list-none editor-nested-listitem',
    },
  },

  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
  },
}
