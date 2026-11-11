import { $getRoot } from 'lexical'
import type { DocumentAssetResolver } from '../asset-session'
import { imageElements, resolveImageData } from '../image-transfer'
import type { LexicalEditor } from 'lexical'
import type { ExportFormat } from '../import/formats'
import { documentFormats } from '../import/formats'

export type { ExportFormat }

export type ExportFile = {
  content: string
  extension: string
  mime: string
  notice?: string
}

const serializers: Record<
  ExportFormat,
  (
    editor: LexicalEditor,
    name: string,
    resolver?: DocumentAssetResolver,
  ) => Promise<{ content: string; notice?: string }>
> = {
  text: async (editor) => ({
    content: editor.getEditorState().read(() => $getRoot().getTextContent()),
  }),
  markdown: async (editor) => {
    // Deferred import to avoid bundling Markdown transformers during initial load
    const { exportMarkdown } = await import('./markdown')
    const state = editor.getEditorState()
    return state.read(() => ({
      content: exportMarkdown(editor),
      notice: JSON.stringify(state.toJSON()).includes('"type":"image"')
        ? 'Markdown represents images as alt text. Use HTML or Concept to preserve images.'
        : undefined,
    }))
  },
  html: async (editor, name, resolver) => {
    // Deferred import to avoid bundling HTML export generator during initial load
    const { exportHtml } = await import('./html')
    const state = editor.getEditorState()
    const html = state.read(() => exportHtml(editor, name))
    const output = new DOMParser().parseFromString(html, 'text/html')
    const images = imageElements(output)
    const data = await resolveImageData(
      images.map(({ id }) => id),
      resolver,
    )
    for (const { element, id } of images) element.src = data.get(id)!
    return { content: `<!doctype html>\n${output.documentElement.outerHTML}` }
  },
}

export async function serializeExport(
  editor: LexicalEditor,
  name: string,
  format: ExportFormat,
  resolver?: DocumentAssetResolver,
): Promise<ExportFile> {
  const spec = documentFormats[format]
  const result = await serializers[format](editor, name, resolver)
  return {
    content: result.content,
    extension: spec.extension,
    mime: spec.mime,
    notice: result.notice,
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
