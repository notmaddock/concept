import { colorPalette } from '#/lib/color-palette'
import { applyDocumentTheme } from './theme-transition'
import type { Doc } from 'yjs'

export const documentThemes = [
  { id: 'default', label: 'Default', color: 'oklch(0.618 0.0778 65.5444)' },
  ...colorPalette.map(({ id, label, value }) => ({ id, label, color: value })),
] as const

export type DocumentTheme = (typeof documentThemes)[number]['id']

export function getDocumentTheme(doc: Doc): DocumentTheme {
  const value = doc.getMap('settings').get('theme')
  if (value === 'yellow') return 'amber'
  if (value === 'purple') return 'violet'
  return documentThemes.find((theme) => theme.id === value)?.id ?? 'default'
}

export function setDocumentTheme(doc: Doc, theme: DocumentTheme) {
  doc.getMap('settings').set('theme', theme)
}

// Apply at the HTML root so body, navigation, and portaled menus share the palette.
export function observeDocumentTheme(
  doc: Doc,
  onChange?: (theme: DocumentTheme) => void,
) {
  const settings = doc.getMap('settings')
  const update = () => {
    const theme = getDocumentTheme(doc)
    applyDocumentTheme(theme)
    onChange?.(theme)
  }
  settings.observe(update)
  update()
  return () => {
    settings.unobserve(update)
  }
}
