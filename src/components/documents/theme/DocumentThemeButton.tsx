import { useCallback, useSyncExternalStore } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
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

const groups = [
  { id: 'default', label: 'Default' },
  { id: 'hue', label: 'Hues' },
  { id: 'scene', label: 'Scenes' },
] as const

const paperPreview = {
  light: {
    background: 'oklch(0.9582 0.0152 90.2357)',
    sheet: 'oklch(0.9914 0.0098 87.4695)',
  },
  dark: {
    background: 'oklch(0.2747 0.0139 57.6523)',
    sheet: 'oklch(0.3237 0.0155 59.0603)',
  },
}

function previewColors(theme: DocumentTheme, mode: 'light' | 'dark') {
  if (theme.id === DEFAULT_DOCUMENT_THEME_ID) return paperPreview[mode]
  const { palette, sheetBackground } = resolveTheme(theme, mode)
  return {
    background: palette['--background'],
    sheet: sheetBackground ?? palette['--card'],
  }
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
  const activeTheme =
    documentThemes.find((theme) => theme.id === themeId) ?? documentThemes[0]
  const activeColors = previewColors(activeTheme, appMode)

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
          <span className="relative">
            <PaletteIcon />
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-background"
              style={{ backgroundColor: activeColors.background }}
            />
          </span>
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
        {groups.map((group) => {
          const themes = documentThemes.filter(
            (theme) => theme.group === group.id,
          )
          if (themes.length === 0) return null
          return (
            <div key={group.id} className="mb-3 last:mb-0">
              <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {themes.map((theme) => {
                  const colors = previewColors(theme, appMode)
                  const active = theme.id === themeId
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      aria-label={theme.label}
                      aria-pressed={active}
                      disabled={readOnly}
                      onClick={() =>
                        selectDocumentTheme(
                          editorRef.current,
                          theme.id,
                          readOnly,
                        )
                      }
                      className={`group flex flex-col gap-1 rounded-md p-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${active ? 'bg-accent' : ''}`}
                    >
                      <span
                        className="relative block h-12 w-full overflow-hidden rounded-sm ring-1 ring-foreground/10"
                        style={{ background: colors.background }}
                      >
                        <span
                          className="absolute inset-x-2 inset-y-1.5 rounded-[3px] shadow-sm"
                          style={{ background: colors.sheet }}
                        />
                      </span>
                      <span className="flex items-center justify-between gap-1 px-0.5 text-[11px] leading-none">
                        <span className="truncate">{theme.label}</span>
                        {active && <CheckIcon className="size-3 shrink-0" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
