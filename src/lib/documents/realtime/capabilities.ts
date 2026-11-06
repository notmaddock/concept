/**
 * Adaptive capabilities object derived from Drive's per-user `capabilities`
 * on a file. Realtime rights mirror `DocumentSync.isReadOnly` but never widen
 * them.
 */
export interface DocumentCapabilities {
  /** File is readable by this user. Required to join the socket at all. */
  view: boolean
  /** canEdit && canModifyContent. Required to send Yjs update messages. */
  edit: boolean
  /** canComment. Reserved for the comment-permission extension. */
  comment: boolean
}

export interface DriveCapabilityFlags {
  canEdit?: boolean
  canComment?: boolean
  canModifyContent?: boolean
}

export function isDocumentCapabilities(value: unknown): value is DocumentCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const caps = value as Record<string, unknown>
  return (
    typeof caps.view === 'boolean' &&
    typeof caps.edit === 'boolean' &&
    typeof caps.comment === 'boolean'
  )
}

/**
 * Maps Drive capability flags to `DocumentCapabilities`. Callers only invoke
 * this after Drive `files.get` succeeded, so `view` is always true here.
 * The edit mapping mirrors `isDriveFileReadOnly` exactly.
 */
export function capabilitiesFromDrive(
  capabilities: DriveCapabilityFlags | undefined,
): DocumentCapabilities {
  return {
    view: true,
    edit:
      capabilities?.canEdit !== false && capabilities?.canModifyContent !== false,
    comment: capabilities?.canComment === true,
  }
}
