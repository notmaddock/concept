import { describe, expect, it } from 'vitest'
import {
  fragmentHtml,
  fragmentReferences,
  parseImageFragment,
} from './fragment'
import { imageDataBlob, imageDataUrl } from '#/lib/documents/image-transfer'

const id = `sha256:${'a'.repeat(64)}`
const image = {
  type: 'image',
  version: 1,
  source: { assetId: id, intrinsicWidth: 12, intrinsicHeight: 8 },
  altText: 'Example',
  displayWidth: 100,
}
const paragraph = {
  type: 'paragraph',
  version: 1,
  children: [{ type: 'text', version: 1, text: 'before' }],
}

describe('portable image fragments', () => {
  it('preserves nested structure, repeated placements and explicit missing bytes', () => {
    const nodes = [
      paragraph,
      {
        type: 'quote',
        version: 1,
        children: [image, { ...image, altText: 'Another placement' }],
      },
      paragraph,
    ]
    const fragment = parseImageFragment(
      JSON.stringify({ version: 1, nodes, assets: { [id]: null } }),
    )
    expect(fragment.nodes).toEqual(nodes)
    expect(fragmentReferences(fragment.nodes).size).toBe(1)
    const html = fragmentHtml('<p>before</p><p>after</p>', fragment)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.body.textContent).toBe('beforeafter')
    expect(
      parseImageFragment(
        document
          .querySelector('[data-concept-fragment]')!
          .getAttribute('data-concept-fragment')!,
      ),
    ).toEqual(fragment)
  })

  it('rejects undeclared, unrelated or invalid image references', () => {
    for (const assets of [
      {},
      { [id]: null, [`sha256:${'b'.repeat(64)}`]: null },
      { [id]: 42 },
    ])
      expect(() =>
        parseImageFragment(
          JSON.stringify({ version: 1, nodes: [image], assets }),
        ),
      ).toThrow()
    expect(() =>
      fragmentReferences([
        Object.assign({}, image, {
          source: { ...image.source, assetId: 'url' },
        }),
      ]),
    ).toThrow()
    expect(() => fragmentReferences([{ ...image, version: 2 }])).toThrow()
  })

  it('bounds nesting before constructing editor nodes', () => {
    let node = { ...paragraph }
    for (let i = 0; i < 70; i++)
      node = { ...paragraph, children: [node] as never }
    expect(() => fragmentReferences([node])).toThrow('complex')
  })

  it('only decodes bounded supported data images', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    })
    const restored = imageDataBlob(await imageDataUrl(blob))
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(
      new Uint8Array(await blob.arrayBuffer()),
    )
    expect(() => imageDataBlob('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
    expect(() => imageDataBlob('https://example.com/image.png')).toThrow()
  })
})

it('keeps surrounding HTML content without fetching external images and rejects excess image work', async () => {
  const { sanitizedHtml, prepareHtmlImages } = await import('./html')
  const html = sanitizedHtml(
    '<p>Before</p><blockquote><img src="https://private.example/a.png" alt="Private" onerror="alert(1)"></blockquote><p>After</p><script>bad()</script>',
  )
  expect(html.querySelector('[onerror],script')).toBeNull()
  expect(html.querySelector('[src],[srcset]')).toBeNull()
  const result = await prepareHtmlImages(html)
  expect(result.images).toEqual([])
  expect(result.unsupported).toBe(1)
  expect(html.body.textContent).toBe('Before[Image: Private]After')
  const excess = sanitizedHtml(
    '<img src="data:image/png;base64,iVBORw0KGgo=">'.repeat(65),
  )
  await expect(prepareHtmlImages(excess)).rejects.toThrow('Too many')
})

it('removes network attributes and unsafe styles while preserving typography', async () => {
  const { sanitizedHtml } = await import('./html')
  const html = sanitizedHtml(
    '<img src="https://private.example/image.png" srcset="https://private.example/large.png 2x"><video poster="https://private.example/poster.png"></video><p style="background-image:url(https://private.example/background.png)">Text</p><span style="color: red; font-weight: bold; position: fixed">Formatted</span>',
  )
  expect(html.querySelector('[src],[srcset],[poster]')).toBeNull()
  expect(html.querySelector('p')!.hasAttribute('style')).toBe(false)
  expect(html.querySelector('span')!.style.color).toBe('red')
  expect(html.querySelector('span')!.style.fontWeight).toBe('bold')
  expect(html.querySelector('span')!.style.position).toBe('')
  expect(html.body.textContent).toBe('TextFormatted')
})

it('sanitizes executable markup and URL schemes without reinterpreting encoded text', async () => {
  const { sanitizedHtml } = await import('./html')
  const html = sanitizedHtml(
    '<p>&lt;img src=x onerror=alert(1)&gt;</p><a href="javascript:alert(1)">Unsafe</a><a href="https://example.com">Safe</a><svg><a onload="alert(1)">bad</a></svg><img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)"><form id="attributes"><input name="children"></form>',
  )
  expect(html.querySelector('p')!.textContent).toBe(
    '<img src=x onerror=alert(1)>',
  )
  expect(html.querySelectorAll('img')).toHaveLength(1)
  expect(
    html.querySelector('[onerror],svg,[href^="javascript:"],#attributes'),
  ).toBeNull()
  expect(html.querySelector('a[href="https://example.com"]')).not.toBeNull()
  expect(
    html.querySelector('img')!.getAttribute('data-concept-input-src'),
  ).toBe('data:image/png;base64,iVBORw0KGgo=')
})

it('distinguishes a bounded future Concept fragment from malformed content', async () => {
  const { UnsupportedFragmentVersionError } = await import('./fragment')
  expect(() =>
    parseImageFragment(
      JSON.stringify({ version: 2, nodes: [paragraph], assets: {} }),
    ),
  ).toThrow(UnsupportedFragmentVersionError)
  expect(() =>
    parseImageFragment(
      JSON.stringify({ version: 2, nodes: [null], assets: {} }),
    ),
  ).toThrow('Invalid')
  expect(() =>
    parseImageFragment(
      JSON.stringify({
        version: 2,
        nodes: [paragraph],
        assets: { broken: 42 },
      }),
    ),
  ).toThrow('Invalid')
})

it('rejects non-object clipboard records with a format error', () => {
  for (const value of ['null', 'false', '12', '"string"', '[]'])
    expect(() => parseImageFragment(value)).toThrow(
      'Invalid Concept clipboard format',
    )
})

it('strips iframes while exposing a known-host embed seam', async () => {
  const { embedFrameSource, sanitizedHtml } = await import('./html')
  const html = sanitizedHtml(
    '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe><iframe src="https://evil.example/embed/abc"></iframe>',
  )
  expect(html.querySelectorAll('iframe')).toHaveLength(0)
  const parsed = new DOMParser().parseFromString(
    '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe><iframe src="https://evil.example/embed/abc"></iframe>',
    'text/html',
  )
  const frames = parsed.querySelectorAll('iframe')
  expect(embedFrameSource(frames[0])).toBe(
    'https://www.youtube-nocookie.com/embed/abc',
  )
  expect(embedFrameSource(frames[1])).toBeNull()
})
