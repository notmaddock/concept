const acceptedImageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export function hasImageDrop(transfer: DataTransfer): boolean {
  return (
    Array.from(transfer.files).some((file) =>
      acceptedImageTypes.has(file.type),
    ) ||
    Array.from(transfer.items).some(
      (item) => item.kind === 'file' && acceptedImageTypes.has(item.type),
    )
  )
}

export function imageDropRange(
  owner: Document,
  x: number,
  y: number,
): Range | null {
  const capabilities: Partial<
    Pick<Document, 'caretRangeFromPoint' | 'caretPositionFromPoint'>
  > = owner
  const range = capabilities.caretRangeFromPoint?.(x, y)
  if (range) return range
  const position = capabilities.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const fallback = owner.createRange()
  fallback.setStart(position.offsetNode, position.offset)
  fallback.collapse(true)
  return fallback
}
