import { $getRoot } from 'lexical'
import type { DocumentAssetResolver } from '../asset-session'
import { imageElements, resolveImageData } from '../image-transfer'
import type { LexicalEditor } from 'lexical'

export type ExportFormat = 'text' | 'markdown' | 'html'

export type ExportFile = {
  content: string
  extension: string
  mime: string
  notice?: string
}

export async function serializeExport(
  editor: LexicalEditor,
  name: string,
  format: ExportFormat,
  resolver?: DocumentAssetResolver,
): Promise<ExportFile> {
  const state = editor.getEditorState()
  if (format === 'text') {
    return state.read(() => ({
      content: $getRoot().getTextContent(),
      extension: 'txt',
      mime: 'text/plain;charset=utf-8',
    }))
  }
  if (format === 'markdown') {
    const { exportMarkdown } = await import('./markdown')
    return state.read(() => ({
      content: exportMarkdown(),
      extension: 'md',
      mime: 'text/markdown;charset=utf-8',
      notice: JSON.stringify(state.toJSON()).includes('"type":"image"')
        ? 'Markdown represents images as alt text. Use HTML or Concept to preserve images.'
        : undefined,
    }))
  }
  const { exportHtml } = await import('./html')
  const html = state.read(() => exportHtml(editor, name))
  const output = new DOMParser().parseFromString(html, 'text/html')
  const images = imageElements(output)
  const data = await resolveImageData(
    images.map(({ id }) => id),
    resolver,
  )
  for (const { element, id } of images) element.src = data.get(id)!
  return {
    content: `<!doctype html>\n${output.documentElement.outerHTML}`,
    extension: 'html',
    mime: 'text/html;charset=utf-8',
  }
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

export function downloadExport(
  name: string,
  file: Omit<ExportFile, 'content'> & { content: string | Blob },
) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = exportFilename(name, file.extension)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
