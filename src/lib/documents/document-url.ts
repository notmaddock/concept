export function documentHash(id: string): string {
  return id.startsWith('G') ? id : `L${id}`
}

export function documentIdFromHash(hash: string): string | undefined {
  if (hash.startsWith('G') && hash.length > 1) return hash
  if (hash.startsWith('L') && hash.length > 1) return hash.slice(1)
  return undefined
}
