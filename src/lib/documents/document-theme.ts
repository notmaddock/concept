import { $getRoot, $getState, $setState, createState } from 'lexical'
import { DEFAULT_DOCUMENT_THEME_ID, documentThemeIds } from './document-themes'
import { createListenerSet } from '#/lib/listener'

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
const listeners = createListenerSet()

export function getDocumentTheme(id: string) {
  return themes.get(id) ?? DEFAULT_DOCUMENT_THEME_ID
}

export function subscribeDocumentTheme(_id: string, listener: () => void) {
  return listeners.subscribe(listener)
}

function notify() {
  listeners.notify()
}

export function publishDocumentTheme(id: string, themeId: string) {
  if (themes.get(id) === themeId) return
  themes.set(id, themeId)
  notify()
}

export function clearDocumentTheme(id: string) {
  if (themes.delete(id)) notify()
}
