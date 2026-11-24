import { createState } from 'lexical'

export const contentsStyles = [
  { id: 'links', label: 'Links only' },
  { id: 'numbers', label: 'Page numbers' },
  { id: 'dotted', label: 'Dotted leaders' },
] as const

export type ContentsStyle = (typeof contentsStyles)[number]['id']

export function parseContentsStyle(value: unknown): ContentsStyle {
  return value === 'numbers' || value === 'dotted' ? value : 'links'
}

export const contentsStyleState = createState('contentsStyle', {
  parse: parseContentsStyle,
})
export const contentsStyleAttribute = 'data-concept-contents-style'
