import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { LocalProvider } from './local-provider'
import {
  $getDocumentTheme,
  $setDocumentTheme,
  documentThemeState,
} from './document-theme'
import {
  DEFAULT_DOCUMENT_THEME_ID,
  documentThemes,
  resolveTheme,
  themePaletteVariables,
} from './document-themes'
import { contrastRatio, cssColorToRgb } from '#/lib/color'

function rgb(value: string) {
  const color = cssColorToRgb(value)
  expect(color, value).not.toBeNull()
  return color!
}

function expectContrast(foreground: string, background: string, label: string) {
  expect(
    contrastRatio(rgb(foreground), rgb(background)),
    `${label}: ${foreground} on ${background}`,
  ).toBeGreaterThanOrEqual(4.5)
}

describe('document theme state', () => {
  it('parses known ids and falls back to paper for anything else', () => {
    expect(documentThemeState.parse('space')).toBe('space')
    expect(documentThemeState.parse('ember')).toBe('ember')
    expect(documentThemeState.parse('nope')).toBe(DEFAULT_DOCUMENT_THEME_ID)
    expect(documentThemeState.parse(42)).toBe(DEFAULT_DOCUMENT_THEME_ID)
    expect(documentThemeState.parse(null)).toBe(DEFAULT_DOCUMENT_THEME_ID)
  })

  it('stores the theme in Yjs updates and restores it', () => {
    const doc = new Doc()
    const editor = createEditor({
      namespace: 'document-theme-test',
      onError: (error) => {
        throw error
      },
    })
    const provider = new LocalProvider('test', doc, {
      whenSynced: Promise.resolve(),
      destroy: async () => {},
    })
    const binding = createYjsBinding({
      editor,
      id: 'test',
      doc,
      docMap: new Map([['test', doc]]),
    })
    const unregister = editor.registerUpdateListener(
      ({
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      }) =>
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        ),
    )
    editor.update(
      () => {
        $getRoot().append($createParagraphNode())
        $setDocumentTheme('dusk')
      },
      { discrete: true },
    )
    const restored = new Doc()
    applyUpdate(restored, encodeStateAsUpdate(doc))
    expect(
      JSON.stringify(restored.get('root', XmlText).getAttributes()),
    ).toContain('dusk')
    const nextEditor = createEditor({
      namespace: 'restore',
      onError: (error) => {
        throw error
      },
    })
    nextEditor.setEditorState(
      nextEditor.parseEditorState(editor.getEditorState().toJSON()),
    )
    expect(nextEditor.getEditorState().read($getDocumentTheme)).toBe('dusk')
    unregister()
    provider.destroy()
    doc.destroy()
    restored.destroy()
  })
})

describe('document theme registry', () => {
  it('has unique ids and an empty paper default', () => {
    const ids = documentThemes.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    const paper = documentThemes.find(
      (theme) => theme.id === DEFAULT_DOCUMENT_THEME_ID,
    )
    expect(paper).toBeDefined()
    expect(paper!.palettes).toEqual({ light: {}, dark: {} })
    expect(paper!.sheetBackground).toBeUndefined()
  })

  it('defines the full palette for every non-default theme', () => {
    for (const theme of documentThemes) {
      if (theme.id === DEFAULT_DOCUMENT_THEME_ID) continue
      for (const mode of ['light', 'dark'] as const) {
        const palette = theme.palettes[mode]
        for (const variable of themePaletteVariables) {
          expect(
            typeof palette[variable],
            `${theme.id} ${mode} ${variable}`,
          ).toBe('string')
          expect(palette[variable].length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('authors palette colors in CSS oklch lightness units', () => {
    for (const theme of documentThemes) {
      for (const mode of ['light', 'dark'] as const) {
        for (const value of Object.values(theme.palettes[mode])) {
          for (const match of value.matchAll(/oklch\(([^)]*)\)/g)) {
            const lightness = Number(match[1].trim().split(/\s+/)[0])
            expect(
              lightness,
              `${theme.id} ${mode} ${value}`,
            ).toBeGreaterThanOrEqual(0)
            expect(
              lightness,
              `${theme.id} ${mode} ${value}`,
            ).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('pins a mode and a sheet background for every scene', () => {
    for (const theme of documentThemes) {
      if (theme.group !== 'scene') {
        expect(theme.mode, theme.id).toBeUndefined()
        continue
      }
      expect(theme.mode, theme.id).toMatch(/^(light|dark)$/)
      expect(theme.sheetBackground?.[theme.mode!], theme.id).toBeTruthy()
    }
  })

  it('resolves scenes to their pinned mode and hues to the app mode', () => {
    const space = documentThemes.find((theme) => theme.id === 'space')!
    expect(resolveTheme(space, 'light').colorScheme).toBe('dark')
    expect(resolveTheme(space, 'light').palette).toBe(space.palettes.dark)
    const ember = documentThemes.find((theme) => theme.id === 'ember')!
    expect(resolveTheme(ember, 'dark').colorScheme).toBe('dark')
    expect(resolveTheme(ember, 'dark').palette).toBe(ember.palettes.dark)
  })
})

describe('document theme contrast', () => {
  it('keeps every palette readable on its page and sheet', () => {
    for (const theme of documentThemes) {
      if (theme.id === DEFAULT_DOCUMENT_THEME_ID) continue
      for (const mode of ['light', 'dark'] as const) {
        const { palette, sheetBackground } = resolveTheme(theme, mode)
        const page = palette['--background']
        const sheet = palette['--card']
        const foreground = palette['--foreground']
        const muted = palette['--muted-foreground']
        const label = `${theme.id} ${mode}`
        expectContrast(foreground, page, `${label} foreground/page`)
        expectContrast(foreground, sheet, `${label} foreground/sheet`)
        expectContrast(muted, page, `${label} muted/page`)
        expectContrast(muted, sheet, `${label} muted/sheet`)
        expectContrast(
          palette['--primary'],
          palette['--primary-foreground'],
          `${label} primary`,
        )
        if (sheetBackground) {
          const stops = sheetBackground.match(/oklch\([^)]*\)/g) ?? []
          expect(stops.length, `${label} scene stops`).toBeGreaterThan(0)
          for (const stop of stops) {
            expectContrast(foreground, stop, `${label} foreground/stop`)
            expectContrast(muted, stop, `${label} muted/stop`)
          }
        }
      }
    }
  })
})
