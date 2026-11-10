import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getDocumentTheme,
  clearDocumentTheme,
  publishDocumentTheme,
} from '#/lib/documents/document-theme'
import {
  getDocumentThemeById,
  resolveTheme,
} from '#/lib/documents/document-themes'
import { useResolvedAppMode } from './use-app-mode'

export function DocumentThemePlugin({
  documentId,
  ready = true,
}: {
  documentId: string
  ready?: boolean
}) {
  const [editor] = useLexicalComposerContext()
  const appMode = useResolvedAppMode()
  const appModeRef = useRef(appMode)
  appModeRef.current = appMode
  const applyRef = useRef<() => void>(() => {})

  useEffect(() => {
    const appliedVariables = new Set<string>()
    let appliedPaletteKey: string | undefined
    let appliedSheet: HTMLElement | null = null
    let disposed = false

    const apply = () => {
      if (disposed) return
      const id = editor.getEditorState().read($getDocumentTheme)
      const theme = getDocumentThemeById(id)
      const mode = appModeRef.current
      const { palette, sheetBackground, colorScheme } = resolveTheme(
        theme,
        mode,
      )
      publishDocumentTheme(documentId, id)

      const root = document.documentElement
      root.dataset.documentTheme = id
      root.style.colorScheme = colorScheme
      const paletteKey = `${id}:${mode}`
      if (paletteKey !== appliedPaletteKey) {
        const nextNames = new Set(Object.keys(palette))
        for (const name of appliedVariables) {
          if (!nextNames.has(name)) root.style.setProperty(name, '')
        }
        for (const [name, value] of Object.entries(palette)) {
          root.style.setProperty(name, value)
        }
        appliedVariables.clear()
        for (const name of nextNames) appliedVariables.add(name)
        appliedPaletteKey = paletteKey
      }

      const sheet =
        editor
          .getRootElement()
          ?.closest<HTMLElement>('[data-document-sheet]') ?? null
      if (sheet !== appliedSheet) {
        if (appliedSheet) {
          appliedSheet.style.background = ''
          appliedSheet.style.removeProperty('--document-page-background')
        }
        appliedSheet = sheet
      }
      if (sheet) {
        sheet.style.background = sheetBackground ?? ''
        sheet.style.setProperty(
          '--document-page-background',
          sheetBackground ?? '',
        )
      }
    }

    applyRef.current = apply
    const unregisterRoot = editor.registerRootListener(apply)
    const unregisterUpdate = editor.registerUpdateListener(apply)
    apply()

    return () => {
      disposed = true
      unregisterRoot()
      unregisterUpdate()
      const root = document.documentElement
      for (const name of appliedVariables) root.style.setProperty(name, '')
      delete root.dataset.documentTheme
      root.style.colorScheme = appModeRef.current
      if (appliedSheet) {
        appliedSheet.style.background = ''
        appliedSheet.style.removeProperty('--document-page-background')
      }
      clearDocumentTheme(documentId)
    }
  }, [editor, documentId])

  useEffect(() => {
    if (ready === false) return
    applyRef.current()
  }, [ready])

  useEffect(() => {
    // ThemeProvider applies the app mode in its own passive effect. Re-assert
    // the document theme after it, so a pinned scene keeps its color scheme.
    if (typeof requestAnimationFrame !== 'function') {
      applyRef.current()
      return
    }
    const frame = requestAnimationFrame(() => applyRef.current())
    return () => cancelAnimationFrame(frame)
  }, [appMode])

  return null
}
