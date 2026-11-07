import { useCallback, useSyncExternalStore } from 'react'
import { PaletteIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Separator } from '#/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import {
  DEFAULT_DOCUMENT_THEME_ID,
  documentThemes,
  resolveTheme,
} from '#/lib/documents/document-themes'
import type { DocumentTheme } from '#/lib/documents/document-themes'
import {
  getDocumentTheme,
  subscribeDocumentTheme,
} from '#/lib/documents/document-theme'
import { useDocumentWorkspace } from '../document-workspace-context'
import { selectDocumentTheme } from './select-document-theme'
import { useResolvedAppMode } from './use-app-mode'

const paperPreview = {
  light: {
    page: 'oklch(0.9582 0.0152 90.2357)',
    sheet: 'oklch(0.9914 0.0098 87.4695)',
  },
  dark: {
    page: 'oklch(0.2747 0.0139 57.6523)',
    sheet: 'oklch(0.3237 0.0155 59.0603)',
  },
}

function previewColors(theme: DocumentTheme, mode: 'light' | 'dark') {
  if (theme.id === DEFAULT_DOCUMENT_THEME_ID) return paperPreview[mode]
  const { palette, sheetBackground } = resolveTheme(theme, mode)
  return {
    page: palette['--background'],
    sheet: sheetBackground ?? palette['--card'],
  }
}

function ThemeSwatch({
  theme,
  mode,
  active,
  readOnly,
  onSelect,
}: {
  theme: DocumentTheme
  mode: 'light' | 'dark'
  active: boolean
  readOnly: boolean
  onSelect: () => void
}) {
  const colors = previewColors(theme, mode)
  const scene = theme.group === 'scene'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={theme.label}
            aria-pressed={active}
            disabled={readOnly}
            onClick={onSelect}
            className={`relative size-10 shrink-0 rounded-full transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
              active
                ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
                : 'ring-1 ring-foreground/10'
            }`}
            style={{ background: scene ? colors.sheet : colors.page }}
          />
        }
      >
        {!scene && (
          <span
            aria-hidden="true"
            className="absolute inset-2 rounded-full ring-1 ring-foreground/10"
            style={{ background: colors.sheet }}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{theme.label}</TooltipContent>
    </Tooltip>
  )
}

export function DocumentThemeButton() {
  const { document, editorRef } = useDocumentWorkspace()
  const documentId = document?.id ?? ''
  const subscribe = useCallback(
    (listener: () => void) => subscribeDocumentTheme(documentId, listener),
    [documentId],
  )
  const themeId = useSyncExternalStore(
    subscribe,
    () => getDocumentTheme(documentId),
    () => DEFAULT_DOCUMENT_THEME_ID,
  )
  const appMode = useResolvedAppMode()
  const readOnly = Boolean(document?.readOnly || document?.drive?.readOnly)
  const colorThemes = documentThemes.filter((theme) => theme.group !== 'scene')
  const sceneThemes = documentThemes.filter((theme) => theme.group === 'scene')
  const select = (id: string) =>
    selectDocumentTheme(editorRef.current, id, readOnly)

  return (
    <Popover modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Document theme"
                  disabled={readOnly}
                />
              }
            />
          }
        >
          <PaletteIcon />
        </TooltipTrigger>
        <TooltipContent>Document theme</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={4}
        finalFocus={false}
        aria-label="Document theme"
        className="w-80 p-3"
      >
        <div
          role="group"
          aria-label="Theme colors"
          className="flex flex-wrap gap-2.5"
        >
          {colorThemes.map((theme) => (
            <ThemeSwatch
              key={theme.id}
              theme={theme}
              mode={appMode}
              active={theme.id === themeId}
              readOnly={readOnly}
              onSelect={() => select(theme.id)}
            />
          ))}
        </div>
        <Separator className="my-3" />
        <div
          role="group"
          aria-label="Scene themes"
          className="flex flex-wrap gap-2.5"
        >
          {sceneThemes.map((theme) => (
            <ThemeSwatch
              key={theme.id}
              theme={theme}
              mode={appMode}
              active={theme.id === themeId}
              readOnly={readOnly}
              onSelect={() => select(theme.id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
