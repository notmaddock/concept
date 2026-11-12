import DOMPurify from 'dompurify'
import { isEmbedFrameHost } from '#/lib/documents/embed-hosts'
import {
  imageDataBlob,
  imageTransferLimits,
} from '#/lib/documents/image-transfer'
import { prepareImage } from '../images/ingestion'

/*
 * P2.6/P2.7 embed exception path. The paste sanitizer still destroys every
 * iframe; embed plugins must call `embedFrameSource` on the untrusted DOM and
 * map a recognized host to a decorator node *before* `sanitizedHtml` runs.
 * Unknown hosts stay stripped.
 */
export function embedFrameSource(frame: HTMLIFrameElement): string | null {
  const source = frame.getAttribute('src')
  if (!source) return null
  try {
    const { hostname } = new URL(source)
    return isEmbedFrameHost(hostname) ? source : null
  } catch {
    return null
  }
}

export function sanitizedHtml(content: string) {
  if (content.length > imageTransferLimits.bytes * 3)
    throw new Error('Clipboard content is too large.')
  const fragment = DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [
      'style',
      'iframe',
      'object',
      'embed',
      'template',
      'link',
      'meta',
    ],
    FORBID_ATTR: ['srcset', 'srcdoc', 'poster', 'background'],
  })
  let count = 0
  const visit = (element: Element, depth: number) => {
    const source =
      element.tagName === 'IMG' ? element.getAttribute('src') : null
    element.removeAttribute('data-concept-input-src')
    if (source?.startsWith('data:'))
      element.setAttribute('data-concept-input-src', source)
    if (
      ++count > imageTransferLimits.nodes ||
      depth > imageTransferLimits.depth
    )
      throw new Error('HTML is too complex.')
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith('on') ||
        [
          'src',
          'srcset',
          'srcdoc',
          'poster',
          'background',
          'xlink:href',
        ].includes(attribute.name) ||
        (attribute.name === 'style' &&
          /url\s*\(|expression\s*\(|@import/i.test(attribute.value))
      )
        element.removeAttribute(attribute.name)
    }
    if (element instanceof HTMLElement && element.hasAttribute('style')) {
      const style = element.style
      for (const property of [...style]) {
        if (
          ![
            'color',
            'background-color',
            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'text-decoration',
            'text-align',
            'vertical-align',
            'line-height',
            'letter-spacing',
            'white-space',
          ].includes(property)
        )
          style.removeProperty(property)
      }
      if (!style.length) element.removeAttribute('style')
    }
    for (const child of element.children) visit(child, depth + 1)
  }
  for (const element of fragment.children) visit(element, 0)
  const document = globalThis.document.implementation.createHTMLDocument('')
  document.body.append(fragment)
  return document
}

export async function prepareHtmlImages(
  document: Document,
  signal?: AbortSignal,
  clipboardFiles: readonly File[] = [],
) {
  const elements = [...document.querySelectorAll('img')]
  if (elements.length > imageTransferLimits.assets)
    throw new Error('Too many embedded images.')
  const images: {
    element: HTMLImageElement
    blob: Blob
    intrinsicWidth: number
    intrinsicHeight: number
  }[] = []
  let unsupported = 0
  let bytes = 0
  let pixels = 0
  for (const element of elements) {
    const source = element.getAttribute('data-concept-input-src') ?? ''
    element.removeAttribute('data-concept-input-src')
    element.removeAttribute('data-concept-image-source')
    element.removeAttribute('data-concept-image-asset-id')
    const clipboardImage =
      elements.length === 1 && clipboardFiles.length === 1
        ? clipboardFiles[0]
        : undefined
    if (!source.startsWith('data:') && !clipboardImage) {
      element.replaceWith(
        document.createTextNode(
          element.alt ? `[Image: ${element.alt}]` : '[Image]',
        ),
      )
      unsupported++
      continue
    }
    let blob: Blob
    if (source.startsWith('data:')) {
      try {
        blob = imageDataBlob(source)
      } catch {
        element.replaceWith(
          document.createTextNode(
            element.alt ? `[Image: ${element.alt}]` : '[Image]',
          ),
        )
        unsupported++
        continue
      }
    } else {
      blob = clipboardImage!
    }
    bytes += blob.size
    if (bytes > imageTransferLimits.bytes)
      throw new Error('Embedded images are too large.')
    const prepared = await prepareImage(blob, signal)
    pixels += prepared.width * prepared.height
    if (pixels > imageTransferLimits.pixels)
      throw new Error('Too many embedded image pixels.')
    images.push({
      element,
      blob: prepared.blob,
      intrinsicWidth: prepared.width,
      intrinsicHeight: prepared.height,
    })
  }
  return { images, unsupported }
}
