// Tailwind's 500 shades share one highlight opacity for coordinated tonal pairs.
export const colorPalette = [
  { id: 'red', label: 'Red', value: '#ef4444' },
  { id: 'orange', label: 'Orange', value: '#f97316' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'violet', label: 'Violet', value: '#8b5cf6' },
  { id: 'pink', label: 'Pink', value: '#ec4899' },
] as const

export const highlightPalette = colorPalette.map(({ label, value }) => ({
  label,
  value: `rgba(${[1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)).join(', ')}, 0.18)`,
}))
