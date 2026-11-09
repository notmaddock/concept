export type DocumentFormat = 'markdown' | 'html' | 'text'
export type ImportFormat = DocumentFormat
export type ExportFormat = DocumentFormat

export interface DocumentFormatDefinition {
  id: DocumentFormat
  label: string
  extension: string
  extensions: Array<string>
  mime: string
}

export const documentFormats: Record<DocumentFormat, DocumentFormatDefinition> =
  {
    markdown: {
      id: 'markdown',
      label: 'Markdown',
      extension: 'md',
      extensions: ['.md', '.markdown', '.mdown'],
      mime: 'text/markdown;charset=utf-8',
    },
    html: {
      id: 'html',
      label: 'HTML',
      extension: 'html',
      extensions: ['.html', '.htm'],
      mime: 'text/html;charset=utf-8',
    },
    text: {
      id: 'text',
      label: 'Plain text',
      extension: 'txt',
      extensions: ['.txt', '.text'],
      mime: 'text/plain;charset=utf-8',
    },
  }

export const importFormats: Array<DocumentFormatDefinition> = [
  documentFormats.markdown,
  documentFormats.html,
  documentFormats.text,
]
