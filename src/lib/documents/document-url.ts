const documentHashPattern = /^[GL][A-Za-z0-9_-]+$/
const headingPattern = /^concept-heading-[a-z0-9-]+$/

export function documentHash(id: string): string {
  return id.startsWith('G') ? id : `L${id}`
}

export function documentIdFromHash(hash: string): string | undefined {
  const parts = hash.split('~')
  const document = parts[0]
  const heading = parts.at(1)
  if (
    !documentHashPattern.test(document) ||
    parts.length > 2 ||
    (heading !== undefined && !headingPattern.test(heading))
  )
    return undefined
  return document.startsWith('G') ? document : document.slice(1)
}

export function headingFromFragment(fragment: string) {
  const hash = fragment.replace(/^#/, '')
  if (headingPattern.test(hash)) return hash
  return documentIdFromHash(hash) ? hash.split('~')[1] : undefined
}

export function headingFragment(
  heading: string,
  location: Pick<Location, 'pathname' | 'hash'>,
) {
  const id =
    location.pathname === '/' &&
    documentIdFromHash(location.hash.replace(/^#/, ''))
  return id ? `${documentHash(id)}~${heading}` : heading
}
