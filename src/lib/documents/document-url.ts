const documentHashPattern = /^[GL][A-Za-z0-9_-]+$/

export function documentHash(id: string): string {
  return id.startsWith('G') ? id : `L${id}`
}

export function documentIdFromHash(hash: string): string | undefined {
  if (!documentHashPattern.test(hash)) return undefined
  return hash.startsWith('G') ? hash : hash.slice(1)
}
