import {
  AlignLeftIcon,
  BoldIcon,
  CaseSensitiveIcon,
  HeadingIcon,
  HighlighterIcon,
  IndentIncreaseIcon,
  LanguagesIcon,
  ListIcon,
  PaletteIcon,
  PilcrowIcon,
  RemoveFormattingIcon,
  TypeIcon,
} from 'lucide-react'
import type { ElementFormatType, TextFormatType } from 'lexical'

export type FormatAction =
  | { kind: 'text'; value: TextFormatType }
  | { kind: 'style'; property: string; value: string }
  | { kind: 'block'; value: string }
  | { kind: 'align'; value: ElementFormatType }
  | { kind: 'list'; value: 'bullet' | 'number' | 'check' | 'none' }
  | { kind: 'indent'; value: 'increase' | 'decrease' }
  | { kind: 'paragraph'; property: string; value: string }
  | { kind: 'direction'; value: 'ltr' | 'rtl' }
  | { kind: 'clear'; value: 'text' | 'paragraph' }

export type FormatChoice = { id: string; label: string; action: FormatAction }
const choice = (
  id: string,
  label: string,
  action: FormatAction,
): FormatChoice => ({ id: `format-${id}`, label, action })
const text = (value: TextFormatType, label: string) =>
  choice(value, label, { kind: 'text', value })
const styles = (property: string, values: [string, string][]) =>
  values.map(([label, value]) =>
    choice(`${property}-${value || 'default'}`, label, {
      kind: 'style',
      property,
      value,
    }),
  )

export const formatSections = [
  {
    id: 'text',
    label: 'Text',
    icon: BoldIcon,
    choices: [
      text('bold', 'Bold'),
      text('italic', 'Italic'),
      text('underline', 'Underline'),
      text('strikethrough', 'Strikethrough'),
      text('code', 'Inline code'),
      text('subscript', 'Subscript'),
      text('superscript', 'Superscript'),
    ],
  },
  {
    id: 'paragraph-style',
    label: 'Paragraph styles',
    icon: HeadingIcon,
    choices: [
      ['paragraph', 'Normal text'],
      ['h1', 'Heading 1'],
      ['h2', 'Heading 2'],
      ['h3', 'Heading 3'],
      ['h4', 'Heading 4'],
      ['h5', 'Heading 5'],
      ['h6', 'Heading 6'],
      ['quote', 'Block quote'],
    ].map(([value, label]) => choice(value, label, { kind: 'block', value })),
  },
  {
    id: 'font-family',
    label: 'Font family',
    icon: TypeIcon,
    choices: styles('font-family', [
      ['Default', ''],
      ['Arial', 'Arial, sans-serif'],
      ['Georgia', 'Georgia, serif'],
      ['Times New Roman', '"Times New Roman", serif'],
      ['Verdana', 'Verdana, sans-serif'],
      ['Courier New', '"Courier New", monospace'],
      ['DM Sans', '"DM Sans Variable", sans-serif'],
      ['Lora', '"Lora Variable", serif'],
      ['IBM Plex Mono', '"IBM Plex Mono", monospace'],
    ]),
  },
  {
    id: 'font-size',
    label: 'Font size',
    icon: TypeIcon,
    choices: styles('font-size', [
      ['Default', ''],
      ...[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map(
        (size): [string, string] => [`${size} pt`, `${size}pt`],
      ),
    ]),
  },
  {
    id: 'text-color',
    label: 'Text color',
    icon: PaletteIcon,
    choices: styles('color', [
      ['Automatic', ''],
      ['Black', '#000000'],
      ['Gray', '#6b7280'],
      ['Red', '#dc2626'],
      ['Orange', '#c2410c'],
      ['Yellow', '#a16207'],
      ['Green', '#15803d'],
      ['Teal', '#0f766e'],
      ['Blue', '#2563eb'],
      ['Purple', '#9333ea'],
      ['Pink', '#db2777'],
      ['White', '#ffffff'],
    ]),
  },
  {
    id: 'highlight',
    label: 'Highlight color',
    icon: HighlighterIcon,
    choices: styles('background-color', [
      ['None', ''],
      ['Yellow', '#fef08a'],
      ['Green', '#bbf7d0'],
      ['Blue', '#bfdbfe'],
      ['Purple', '#e9d5ff'],
      ['Pink', '#fbcfe8'],
      ['Orange', '#fed7aa'],
      ['Gray', '#e5e7eb'],
    ]),
  },
  {
    id: 'case',
    label: 'Capitalization',
    icon: CaseSensitiveIcon,
    choices: [
      text('lowercase', 'lowercase'),
      text('uppercase', 'UPPERCASE'),
      text('capitalize', 'Title Case'),
    ],
  },
  {
    id: 'alignment',
    label: 'Alignment',
    icon: AlignLeftIcon,
    choices: (
      ['left', 'center', 'right', 'justify', 'start', 'end'] as const
    ).map((value) =>
      choice(`align-${value}`, value[0].toUpperCase() + value.slice(1), {
        kind: 'align',
        value,
      }),
    ),
  },
  {
    id: 'spacing',
    label: 'Line & paragraph spacing',
    icon: PilcrowIcon,
    choices: [
      ...[
        ['Single', '1'],
        ['1.15', '1.15'],
        ['1.5', '1.5'],
        ['Double', '2'],
        ['2.5', '2.5'],
        ['Triple', '3'],
      ].map(([label, value]) =>
        choice(`line-${value}`, label, {
          kind: 'paragraph',
          property: 'line-height',
          value,
        }),
      ),
      ...['before', 'after'].flatMap((side) =>
        [0, 4, 8, 12, 16, 24].map((size) =>
          choice(`space-${side}-${size}`, `${size} pt ${side} paragraph`, {
            kind: 'paragraph',
            property: side === 'before' ? 'margin-top' : 'margin-bottom',
            value: `${size}pt`,
          }),
        ),
      ),
    ],
  },
  {
    id: 'lists',
    label: 'Lists',
    icon: ListIcon,
    choices: (
      [
        ['bullet', 'Bulleted list'],
        ['number', 'Numbered list'],
        ['check', 'Checklist'],
        ['none', 'Remove list'],
      ] as const
    ).map(([value, label]) =>
      choice(`list-${value}`, label, { kind: 'list', value }),
    ),
  },
  {
    id: 'indent',
    label: 'Indentation',
    icon: IndentIncreaseIcon,
    choices: [
      choice('indent-increase', 'Increase indent', {
        kind: 'indent',
        value: 'increase',
      }),
      choice('indent-decrease', 'Decrease indent', {
        kind: 'indent',
        value: 'decrease',
      }),
    ],
  },
  {
    id: 'direction',
    label: 'Text direction',
    icon: LanguagesIcon,
    choices: [
      choice('ltr', 'Left to right', { kind: 'direction', value: 'ltr' }),
      choice('rtl', 'Right to left', { kind: 'direction', value: 'rtl' }),
    ],
  },
  {
    id: 'reset',
    label: 'Clear formatting',
    icon: RemoveFormattingIcon,
    choices: [
      choice('clear-text', 'Clear text formatting', {
        kind: 'clear',
        value: 'text',
      }),
      choice('clear-paragraph', 'Reset paragraph formatting', {
        kind: 'clear',
        value: 'paragraph',
      }),
    ],
  },
]
