export type ImportFormat = 'markdown' | 'html' | 'text'
export type ExportFormat = 'markdown' | 'html' | 'text'
export type DocumentFormat = ImportFormat | ExportFormat

export interface DocumentFormatDefinition<
  TFormat extends DocumentFormat = DocumentFormat,
> {
  id: TFormat
  label: string
  extension: string
  extensions: Array<string>
  mime: string
}

type DocumentFormatDefinitions = {
  [TFormat in DocumentFormat]: DocumentFormatDefinition<TFormat>
}

export const documentFormats: DocumentFormatDefinitions = {
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

export const importFormats: Array<DocumentFormatDefinition<ImportFormat>> = [
  documentFormats.markdown,
  documentFormats.html,
  documentFormats.text,
]

export const exportFormats: Array<DocumentFormatDefinition<ExportFormat>> = [
  documentFormats.markdown,
  documentFormats.html,
  documentFormats.text,
]
