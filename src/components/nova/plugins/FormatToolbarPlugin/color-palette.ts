// Tailwind's 500 shades share one highlight opacity for coordinated tonal pairs.
export const colorPalette = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' },
]

export const highlightPalette = colorPalette.map(({ label, value }) => ({
  label,
  value: `rgba(${[1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)).join(', ')}, 0.18)`,
}))
