export type DocumentAccess =
  | { kind: 'local' }
  | { kind: 'editor' | 'viewer'; checkedAt: number }
  | {
      kind: 'unverified'
      previous: 'editor' | 'viewer'
      reason: 'offline' | 'authentication' | 'temporary'
    }
  | { kind: 'unavailable'; checkedAt: number }

export const accessTiming = { refreshMs: 30_000 }

export function canEditLocally(access: DocumentAccess) {
  return (
    access.kind === 'local' ||
    access.kind === 'editor' ||
    (access.kind === 'unverified' && access.previous === 'editor')
  )
}
