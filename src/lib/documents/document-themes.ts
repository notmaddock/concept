import { contrastRatio, cssColorToRgb, hexToOklch } from '#/lib/color'

export type ThemePalette = Record<string, string>

export type DocumentTheme = {
  id: string
  label: string
  group: 'default' | 'hue' | 'scene'
  /** Scenes pin a mode. Hues and the default follow the app mode. */
  mode?: 'light' | 'dark'
  palettes: { light: ThemePalette; dark: ThemePalette }
  /** Painted only on [data-document-sheet], never on the viewport. */
  sheetBackground?: { light?: string; dark?: string }
}

export const DEFAULT_DOCUMENT_THEME_ID = 'paper'

export const themePaletteVariables = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--destructive',
  '--destructive-foreground',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
] as const

const round = (value: number, digits: number) =>
  Number(value.toFixed(digits)).toString()

const oklch = (l: number, c: number, h: number) =>
  `oklch(${round(l, 3)} ${round(c, 4)} ${round(h, 2)})`

const white = 'oklch(1 0 0)'
const black = 'oklch(0 0 0)'
const destructive = 'oklch(0.55 0.16 27)'

function readableForeground(color: string) {
  const rgb = cssColorToRgb(color)
  if (!rgb) return white
  return contrastRatio(rgb, [255, 255, 255]) >= contrastRatio(rgb, [0, 0, 0])
    ? white
    : black
}

function huePalette(
  mode: 'light' | 'dark',
  hue: number,
  primary: string,
  primaryForeground: string,
): ThemePalette {
  const light = mode === 'light'
  const foreground = light ? oklch(0.27, 0.02, hue) : oklch(0.95, 0.01, hue)
  const card = light ? oklch(0.99, 0.006, hue) : oklch(0.27, 0.025, hue)
  const secondary = light ? oklch(0.9, 0.02, hue) : oklch(0.33, 0.03, hue)
  const muted = light ? oklch(0.92, 0.015, hue) : oklch(0.25, 0.02, hue)
  const accent = light ? oklch(0.88, 0.03, hue) : oklch(0.35, 0.04, hue)
  const border = light ? oklch(0.86, 0.03, hue) : oklch(0.38, 0.03, hue)
  const sidebar = light ? oklch(0.93, 0.018, hue) : oklch(0.21, 0.02, hue)
  return {
    '--background': light ? oklch(0.955, 0.012, hue) : oklch(0.21, 0.02, hue),
    '--foreground': foreground,
    '--card': card,
    '--card-foreground': foreground,
    '--popover': light ? card : oklch(0.29, 0.025, hue),
    '--popover-foreground': foreground,
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--secondary': secondary,
    '--secondary-foreground': foreground,
    '--muted': muted,
    '--muted-foreground': light
      ? oklch(0.45, 0.03, hue)
      : oklch(0.72, 0.03, hue),
    '--accent': accent,
    '--accent-foreground': foreground,
    '--border': border,
    '--input': border,
    '--ring': primary,
    '--destructive': destructive,
    '--destructive-foreground': white,
    '--sidebar': sidebar,
    '--sidebar-foreground': foreground,
    '--sidebar-primary': primary,
    '--sidebar-primary-foreground': primaryForeground,
    '--sidebar-accent': accent,
    '--sidebar-accent-foreground': foreground,
    '--sidebar-border': border,
    '--sidebar-ring': primary,
  }
}

function hueTheme(
  id: string,
  label: string,
  swatchHex: string,
  textHex: string,
): DocumentTheme {
  const swatch = hexToOklch(swatchHex)
  const text = hexToOklch(textHex)
  const primaryLight = oklch(text.l, text.c, swatch.h)
  const primaryDark = oklch(swatch.l, swatch.c, swatch.h)
  return {
    id,
    label,
    group: 'hue',
    palettes: {
      light: huePalette('light', swatch.h, primaryLight, white),
      dark: huePalette(
        'dark',
        swatch.h,
        primaryDark,
        readableForeground(primaryDark),
      ),
    },
  }
}

type SceneColors = {
  page: string
  card: string
  popover: string
  sidebar: string
  foreground: string
  mutedForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  muted: string
  accent: string
  border: string
}

function scenePalette(colors: SceneColors): ThemePalette {
  return {
    '--background': colors.page,
    '--foreground': colors.foreground,
    '--card': colors.card,
    '--card-foreground': colors.foreground,
    '--popover': colors.popover,
    '--popover-foreground': colors.foreground,
    '--primary': colors.primary,
    '--primary-foreground': colors.primaryForeground,
    '--secondary': colors.secondary,
    '--secondary-foreground': colors.foreground,
    '--muted': colors.muted,
    '--muted-foreground': colors.mutedForeground,
    '--accent': colors.accent,
    '--accent-foreground': colors.foreground,
    '--border': colors.border,
    '--input': colors.border,
    '--ring': colors.primary,
    '--destructive': destructive,
    '--destructive-foreground': white,
    '--sidebar': colors.sidebar,
    '--sidebar-foreground': colors.foreground,
    '--sidebar-primary': colors.primary,
    '--sidebar-primary-foreground': colors.primaryForeground,
    '--sidebar-accent': colors.accent,
    '--sidebar-accent-foreground': colors.foreground,
    '--sidebar-border': colors.border,
    '--sidebar-ring': colors.primary,
  }
}

const spaceBackground = [
  'radial-gradient(circle at 18% 22%, rgba(255,255,255,0.9) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 72% 14%, rgba(255,255,255,0.8) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 42% 38%, rgba(255,255,255,0.7) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 86% 52%, rgba(255,255,255,0.9) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 28% 68%, rgba(255,255,255,0.8) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 64% 82%, rgba(255,255,255,0.7) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 12% 88%, rgba(255,255,255,0.8) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 78% 72%, rgba(255,255,255,0.9) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 50% 8%, rgba(255,255,255,0.8) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 92% 32%, rgba(255,255,255,0.7) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 8% 48%, rgba(255,255,255,0.8) 0 1px, transparent 1.6px)',
  'radial-gradient(ellipse at 70% 30%, rgba(255,255,255,0.12), transparent 35%)',
  'linear-gradient(180deg, oklch(0.20 0.07 265), oklch(0.38 0.10 250))',
].join(', ')

const skyBackground = [
  'radial-gradient(ellipse at 20% 25%, rgba(255,255,255,0.9), transparent 30%)',
  'radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.7), transparent 28%)',
  'radial-gradient(ellipse at 45% 60%, rgba(255,255,255,0.6), transparent 35%)',
  'radial-gradient(ellipse at 85% 75%, rgba(255,255,255,0.8), transparent 30%)',
  'linear-gradient(180deg, oklch(0.75 0.09 230), oklch(0.93 0.03 230))',
].join(', ')

const duskBackground = [
  'radial-gradient(ellipse at 30% 20%, rgba(255,200,120,0.25), transparent 40%)',
  'radial-gradient(ellipse at 75% 70%, rgba(255,120,180,0.2), transparent 45%)',
  'linear-gradient(180deg, oklch(0.45 0.16 25), oklch(0.30 0.10 330))',
].join(', ')

const space = scenePalette({
  page: 'oklch(0.17 0.05 265)',
  card: 'oklch(0.24 0.07 260)',
  popover: 'oklch(0.22 0.06 265)',
  sidebar: 'oklch(0.18 0.05 265)',
  foreground: 'oklch(0.96 0.01 250)',
  mutedForeground: 'oklch(0.78 0.03 250)',
  primary: 'oklch(0.72 0.14 250)',
  primaryForeground: 'oklch(0.17 0.05 265)',
  secondary: 'oklch(0.30 0.06 260)',
  muted: 'oklch(0.25 0.05 260)',
  accent: 'oklch(0.34 0.07 255)',
  border: 'oklch(0.36 0.06 260)',
})

const sky = scenePalette({
  page: 'oklch(0.92 0.03 230)',
  card: 'oklch(0.88 0.05 230)',
  popover: 'oklch(0.90 0.04 230)',
  sidebar: 'oklch(0.90 0.035 230)',
  foreground: 'oklch(0.27 0.03 240)',
  mutedForeground: 'oklch(0.36 0.04 240)',
  primary: 'oklch(0.50 0.12 230)',
  primaryForeground: white,
  secondary: 'oklch(0.84 0.05 230)',
  muted: 'oklch(0.86 0.04 230)',
  accent: 'oklch(0.80 0.07 230)',
  border: 'oklch(0.78 0.05 230)',
})

const dusk = scenePalette({
  page: 'oklch(0.19 0.06 330)',
  card: 'oklch(0.27 0.08 340)',
  popover: 'oklch(0.24 0.07 335)',
  sidebar: 'oklch(0.20 0.06 330)',
  foreground: 'oklch(0.96 0.01 40)',
  mutedForeground: 'oklch(0.86 0.04 30)',
  primary: 'oklch(0.72 0.15 40)',
  primaryForeground: 'oklch(0.19 0.06 330)',
  secondary: 'oklch(0.32 0.08 340)',
  muted: 'oklch(0.26 0.06 335)',
  accent: 'oklch(0.36 0.10 350)',
  border: 'oklch(0.38 0.07 340)',
})

export const documentThemes: DocumentTheme[] = [
  {
    id: DEFAULT_DOCUMENT_THEME_ID,
    label: 'Paper',
    group: 'default',
    palettes: { light: {}, dark: {} },
  },
  hueTheme('ember', 'Ember', '#ef4444', '#dc2626'),
  hueTheme('sunset', 'Sunset', '#f97316', '#c2410c'),
  hueTheme('honey', 'Honey', '#f59e0b', '#a16207'),
  hueTheme('moss', 'Moss', '#22c55e', '#15803d'),
  hueTheme('lagoon', 'Lagoon', '#06b6d4', '#0f766e'),
  hueTheme('ocean', 'Ocean', '#3b82f6', '#2563eb'),
  hueTheme('iris', 'Iris', '#8b5cf6', '#9333ea'),
  hueTheme('rose', 'Rose', '#ec4899', '#db2777'),
  hueTheme('graphite', 'Graphite', '#6b7280', '#4b5563'),
  {
    id: 'space',
    label: 'Space',
    group: 'scene',
    mode: 'dark',
    palettes: { light: space, dark: space },
    sheetBackground: { light: spaceBackground, dark: spaceBackground },
  },
  {
    id: 'sky',
    label: 'Sky',
    group: 'scene',
    mode: 'light',
    palettes: { light: sky, dark: sky },
    sheetBackground: { light: skyBackground, dark: skyBackground },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    group: 'scene',
    mode: 'dark',
    palettes: { light: dusk, dark: dusk },
    sheetBackground: { light: duskBackground, dark: duskBackground },
  },
]

export const documentThemeIds = new Set(documentThemes.map((theme) => theme.id))

export function getDocumentThemeById(id: string): DocumentTheme {
  return (
    documentThemes.find((theme) => theme.id === id) ??
    documentThemes.find((theme) => theme.id === DEFAULT_DOCUMENT_THEME_ID)!
  )
}

export function resolveTheme(
  theme: DocumentTheme,
  appMode: 'light' | 'dark',
): {
  palette: ThemePalette
  sheetBackground: string | undefined
  colorScheme: 'light' | 'dark'
} {
  const mode = theme.mode ?? appMode
  return {
    palette: theme.palettes[mode],
    sheetBackground: theme.sheetBackground?.[mode],
    colorScheme: mode,
  }
}
