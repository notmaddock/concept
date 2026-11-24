import {
  $readOutline,
  contentsAttribute,
  contentsTitle,
  nestOutline,
} from './outline'
import type { OutlineItem } from './outline'

const contentsSelector = `nav[${contentsAttribute}="true"]`
const exportedHeadingId = (index: number) => `concept-heading-${index + 1}`

export const outlineHtmlStyles = `
${contentsSelector} { border: 1px solid #ccc; border-radius: 0.5rem; margin: 1.5rem 0; padding: 0.75rem 1rem; }
${contentsSelector} p { margin: 0 0 0.5rem; }
${contentsSelector} ul { list-style: none; margin: 0; padding-inline-start: 0; }
${contentsSelector} ul ul { list-style: none; padding-inline-start: 1rem; }
`

function appendEntries(
  document: Document,
  parent: HTMLElement,
  items: readonly OutlineItem[],
) {
  if (items.length === 0) return
  const list = document.createElement('ul')
  for (const { index, text, children } of items) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${exportedHeadingId(index)}`
    link.textContent = text
    item.append(link)
    appendEntries(document, item, children)
    list.append(item)
  }
  parent.append(list)
}

export function $createExportedContents(document: Document) {
  const element = document.createElement('nav')
  element.setAttribute(contentsAttribute, 'true')
  element.setAttribute('aria-label', contentsTitle)
  const title = document.createElement('p')
  const label = document.createElement('strong')
  label.textContent = contentsTitle
  title.append(label)
  element.append(title)
  appendEntries(document, element, nestOutline($readOutline()))
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
