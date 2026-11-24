import {
  $readOutline,
  contentsAttribute,
  contentsTitle,
  nestOutline,
} from './outline'
import type { OutlineItem } from './outline'
import { contentsStyleAttribute } from './contents-style'
import type { ContentsStyle } from './contents-style'

const contentsSelector = `nav[${contentsAttribute}="true"]`
const exportedHeadingId = (index: number) => `concept-heading-${index + 1}`

export const outlineHtmlStyles = `
${contentsSelector} { margin: 1.5rem 0; }
${contentsSelector} ul { list-style: none; margin: 0; padding-inline-start: 0; }
${contentsSelector} ul ul { list-style: none; padding-inline-start: 1rem; }
${contentsSelector} a { display: flex; align-items: baseline; gap: .5rem; }
${contentsSelector} [data-concept-page-leader] { flex: 1; min-width: .5rem; }
${contentsSelector}[${contentsStyleAttribute}="dotted"] [data-concept-page-leader] { border-bottom: 1px dotted currentColor; opacity: .5; }
`

function appendEntries(
  document: Document,
  parent: HTMLElement,
  items: readonly OutlineItem[],
  style: ContentsStyle,
) {
  if (items.length === 0) return
  const list = document.createElement('ul')
  for (const { index, text, children, page } of items) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${exportedHeadingId(index)}`
    const label = document.createElement('span')
    label.textContent = text
    link.append(label)
    if (style !== 'links' && page !== null) {
      const leader = document.createElement('span')
      leader.setAttribute('data-concept-page-leader', '')
      leader.setAttribute('aria-hidden', 'true')
      const number = document.createElement('span')
      number.textContent = String(page)
      number.setAttribute('aria-label', `Page ${page}`)
      link.append(leader, number)
    }
    item.append(link)
    appendEntries(document, item, children, style)
    list.append(item)
  }
  parent.append(list)
}

export function $createExportedContents(
  document: Document,
  style: ContentsStyle,
) {
  const element = document.createElement('nav')
  element.setAttribute(contentsAttribute, 'true')
  element.setAttribute('aria-label', contentsTitle)
  element.setAttribute(contentsStyleAttribute, style)
  appendEntries(document, element, nestOutline($readOutline()), style)
  return element
}

export function prepareHtmlOutline(body: HTMLElement) {
  if (!body.querySelector(contentsSelector)) return
  const headings = body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  let index = 0
  for (const heading of headings) {
    if (heading.textContent.trim()) heading.id = exportedHeadingId(index++)
  }
}

export function isExportedOutlineLink(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href') ?? ''
  return (
    /^#concept-heading-[1-9]\d*$/.test(href) &&
    anchor.closest(contentsSelector) !== null
  )
}
