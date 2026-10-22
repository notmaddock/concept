export type ImportFormat = 'markdown' | 'html' | 'text'

export const importFormats: Array<{
  id: ImportFormat
  label: string
  extensions: Array<string>
}> = [
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown', '.mdown'],
  },
  { id: 'html', label: 'HTML', extensions: ['.html', '.htm'] },
  { id: 'text', label: 'Plain text', extensions: ['.txt', '.text'] },
]
