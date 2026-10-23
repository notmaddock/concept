import { $getRoot } from 'lexical'
import type { LexicalEditor } from 'lexical'

export type ExportFormat = 'text' | 'markdown' | 'html'

export type ExportFile = {
  content: string
  extension: string
  mime: string
}

export async function serializeExport(
  editor: LexicalEditor,
  name: string,
  format: ExportFormat,
): Promise<ExportFile> {
  if (format === 'text') {
    return editor.read(() => ({
      content: $getRoot().getTextContent(),
      extension: 'txt',
      mime: 'text/plain;charset=utf-8',
    }))
  }
  if (format === 'markdown') {
    const { exportMarkdown } = await import('./markdown')
    return editor.read(() => ({
      content: exportMarkdown(),
      extension: 'md',
      mime: 'text/markdown;charset=utf-8',
    }))
  }
  const { exportHtml } = await import('./html')
  return editor.read(() => ({
    content: exportHtml(editor, name),
    extension: 'html',
    mime: 'text/html;charset=utf-8',
  }))
}

export function exportFilename(name: string, extension: string) {
  const safeName = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
      ? '_'
      : character,
  )
    .join('')
    .replace(/[. ]+$/, '')
  return `${safeName || 'Untitled document'}.${extension}`
}

export function downloadExport(name: string, file: ExportFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = exportFilename(name, file.extension)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
