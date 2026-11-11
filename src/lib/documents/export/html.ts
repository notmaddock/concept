import { $generateHtmlFromNodes } from '@lexical/html'
import type { LexicalEditor } from 'lexical'
import { linkAttributes, normalizeLinkUrl } from '../link-policy'
import { $getPageSetup, pageDimensions } from '../page-setup'

export function exportHtml(editor: LexicalEditor, name: string) {
  const output = document.implementation.createHTMLDocument(name)
  output.documentElement.lang = 'en'
  const charset = output.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const policy = output.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
  const style = output.createElement('style')
  const setup = $getPageSetup()
  const { width, height } = pageDimensions(setup)
  const { top, right, bottom, left } = setup.margins
  style.textContent = `
body { max-width: 72ch; margin: 3rem auto; padding: 0 1.5rem; color: #111; background: white; font: 12pt/1.5 Georgia, serif; overflow-wrap: anywhere; }
h1,h2,h3,h4,h5,h6 { break-after: avoid; }
blockquote { border-left: 3px solid #aaa; margin-left: 0; padding-left: 1rem; }
pre { white-space: pre-wrap; } code,pre { font-family: monospace; }
ul { list-style: disc; } ul ul { list-style: circle; }
ul[data-lexical-list-type="check"] { list-style: none; padding-left: 1rem; }
li[aria-checked="true"]::before { content: '☑ '; }
li[aria-checked="false"]::before { content: '☐ '; }
img,table { max-width: 100%; } img { height: auto; }
@media print { @page { ${setup.mode === 'paper' ? `size: ${width}mm ${height}mm; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm;` : 'margin: 25.4mm;'} } body { max-width: none; margin: 0; padding: 0; } }
`
  output.head.prepend(charset, policy)
  output.head.append(style)
  output.body.innerHTML = $generateHtmlFromNodes(editor, null)
  output.body
    .querySelectorAll('ul[__lexicalListType="check"]')
    .forEach((list) => {
      list.setAttribute('data-lexical-list-type', 'check')
      list.removeAttribute('__lexicalListType')
    })
  output.body.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    if (!normalizeLinkUrl(href)) {
      anchor.removeAttribute('href')
      return
    }
    const attributes = linkAttributes(href)
    if (attributes.target) anchor.setAttribute('target', attributes.target)
    if (attributes.rel) anchor.setAttribute('rel', attributes.rel)
  })
  output.body
    .querySelectorAll('code[data-language], pre[data-language]')
    .forEach((element) => {
      const language = element.getAttribute('data-language')
      if (language) element.classList.add(`language-${language}`)
    })
  /*
   * Export class policy: the exported document is standalone and its CSP is
   * `default-src 'none'; style-src 'unsafe-inline'; img-src data:`, so app
   * theme classes cannot resolve. Keep only classes that carry exported
   * meaning: Prism's `token` and `language-*` markers. KaTeX/Mermaid classes
   * should be added to this allowlist with their inline styles when those
   * exporters land. Everything else is stripped.
   */
  output.body.querySelectorAll('[class]').forEach((element) => {
    const kept = [...element.classList].filter(
      (className) => className === 'token' || className.startsWith('language-'),
    )
    if (kept.length) element.className = kept.join(' ')
    else element.removeAttribute('class')
  })
  return `<!doctype html>\n${output.documentElement.outerHTML}`
}
