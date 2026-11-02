import { defaultFilter } from 'cmdk'

export function filterDocumentAction(
  value: string,
  search: string,
  keywords: string[] = [],
) {
  const query = search.trim().toLowerCase()
  const label = (keywords[0] ?? value).trim().toLowerCase()
  if (!query || label === query) return 1
  if (label.startsWith(query)) return 0.9
  if (label.includes(query)) return 0.8
  return defaultFilter(value, query, keywords) * 0.5
}
