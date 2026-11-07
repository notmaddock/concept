import { $getRoot, $getState, $setState, createState } from 'lexical'
import { DEFAULT_DOCUMENT_THEME_ID, documentThemeIds } from './document-themes'

export const documentThemeState = createState('documentTheme', {
  parse(value: unknown): string {
    return typeof value === 'string' && documentThemeIds.has(value)
      ? value
      : DEFAULT_DOCUMENT_THEME_ID
  },
})

export function $getDocumentTheme() {
  return $getState($getRoot(), documentThemeState)
}

export function $setDocumentTheme(id: string) {
  $setState($getRoot(), documentThemeState, id)
}

const themes = new Map<string, string>()
const listeners = new Set<() => void>()

export function getDocumentTheme(id: string) {
  return themes.get(id) ?? DEFAULT_DOCUMENT_THEME_ID
}

export function subscribeDocumentTheme(_id: string, listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify() {
  listeners.forEach((listener) => listener())
}

export function publishDocumentTheme(id: string, themeId: string) {
  if (themes.get(id) === themeId) return
  themes.set(id, themeId)
  notify()
}

export function clearDocumentTheme(id: string) {
  if (themes.delete(id)) notify()
}
