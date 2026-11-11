import type { EditorThemeClasses } from 'lexical'

export const defaultEditorTheme: EditorThemeClasses = {
  paragraph: 'mb-2 leading-relaxed',

  heading: {
    h1: 'text-3xl font-bold tracking-tight mb-4',
    h2: 'text-2xl font-semibold tracking-tight mb-3',
    h3: 'text-xl font-semibold mb-2',
    h4: 'text-lg font-semibold mb-2',
    h5: 'text-base font-semibold mb-2',
    h6: 'text-sm font-semibold mb-2',
  },

  quote: 'border-l-2 border-primary/60 pl-4 italic text-muted-foreground my-3',

  code: 'my-3 block overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap',

  codeHighlight: {
    atrule: 'text-purple-600 dark:text-purple-400',
    attr: 'text-amber-700 dark:text-amber-400',
    boolean: 'text-purple-600 dark:text-purple-400',
    character: 'text-emerald-700 dark:text-emerald-400',
    comment: 'text-muted-foreground italic',
    constant: 'text-purple-600 dark:text-purple-400',
    deleted: 'text-red-600 dark:text-red-400',
    function: 'text-blue-700 dark:text-blue-400',
    important: 'text-red-600 dark:text-red-400 font-semibold',
    inserted: 'text-emerald-700 dark:text-emerald-400',
    keyword: 'text-purple-600 dark:text-purple-400',
    number: 'text-amber-700 dark:text-amber-400',
    operator: 'text-muted-foreground',
    property: 'text-blue-700 dark:text-blue-400',
    selector: 'text-emerald-700 dark:text-emerald-400',
    string: 'text-emerald-700 dark:text-emerald-400',
    symbol: 'text-amber-700 dark:text-amber-400',
    tag: 'text-red-600 dark:text-red-400',
    url: 'text-blue-700 dark:text-blue-400 underline',
    variable: 'text-amber-700 dark:text-amber-400',
  },

  hr: 'my-4 border-t border-border cursor-pointer',
  hrSelected: 'outline-2 outline-primary ring-2 ring-primary',

  list: {
    ul: 'list-disc list-inside mb-2',
    ol: 'list-decimal list-inside mb-2',
    checklist:
      'list-none! pl-0! ml-1 my-2 space-y-1.5 [&_ul]:ml-6 [&_ul]:my-1 [&_ol]:ml-6 [&_ol]:my-1',
    listitem: 'ml-4',
    listitemChecked: 'editor-checklist-item-checked',
    listitemUnchecked: 'editor-checklist-item-unchecked',
    nested: {
      list: 'my-1',
      listitem: 'list-none editor-nested-listitem',
    },
  },

  text: {
    code: 'rounded bg-muted px-1 font-mono text-sm',
    subscript: 'align-sub text-xs',
    superscript: 'align-super text-xs',
    lowercase: 'lowercase',
    uppercase: 'uppercase',
    capitalize: 'capitalize',
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
  },
}
