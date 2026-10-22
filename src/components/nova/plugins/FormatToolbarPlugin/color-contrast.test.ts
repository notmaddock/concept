import { expect, it } from 'vitest'
import { colorPalette, highlightPalette } from './color-palette'
import { formatSections } from '#/components/documents/navigation-menus/format-options'
import { contrastRatio, readableColor } from './color-contrast'
import type { RGB } from './color-contrast'

const palette = (id: string) =>
  formatSections
    .find((section) => section.id === id)!
    .choices.flatMap(({ action }) =>
      action.kind === 'style' && action.value ? [action.value] : [],
    )
const rgb = (hex: string): RGB =>
  [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as RGB

it('keeps every foreground readable on every highlight and light/dark editor background', () => {
  const backgrounds = [...palette('highlight'), '#ffffff', '#37302a', '#000000']
  for (const foreground of palette('text-color')) {
    for (const background of backgrounds) {
      expect(
        contrastRatio(
          readableColor(rgb(foreground), rgb(background)),
          rgb(background),
        ),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it('preserves colors that already have sufficient contrast', () => {
  expect(readableColor([37, 99, 235], [255, 255, 255])).toEqual([37, 99, 235])
})

it('keeps all rainbow text and tonal highlight combinations readable on light and dark surfaces', () => {
  for (const surface of ['#ffffff', '#37302a', '#000000']) {
    for (const highlight of colorPalette) {
      const background = rgb(highlight.value).map((channel, index) =>
        Math.round(channel * 0.18 + rgb(surface)[index] * 0.82),
      ) as RGB
      for (const text of colorPalette) {
        expect(
          contrastRatio(readableColor(rgb(text.value), background), background),
          `${text.label} on ${highlight.label} / ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
  expect(highlightPalette.every(({ value }) => value.endsWith(', 0.18)'))).toBe(
    true,
  )
})
