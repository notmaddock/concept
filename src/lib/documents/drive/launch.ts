/**
 * Google Drive UI integration passes a URL-encoded JSON `state` parameter to
 * the app's Open URL or New URL. These helpers validate that payload before any
 * Drive request is made.
 *
 * @see https://developers.google.com/workspace/drive/api/guides/enable-sdk#construct
 */

export interface DriveOpenLaunch {
  action: 'open'
  ids: Array<string>
  resourceKeys: Record<string, string>
  userId?: string
}

export interface DriveCreateLaunch {
  action: 'create'
  folderId?: string
  folderResourceKey?: string
  userId?: string
}

export type DriveLaunch = DriveOpenLaunch | DriveCreateLaunch

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseIds(value: unknown): Array<string> {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return values.flatMap((item) => {
    const id = nonEmptyString(item)
    return id ? [id] : []
  })
}

function parseResourceKeys(value: unknown): Record<string, string> {
  const keys = record(value)
  if (!keys) return {}
  return Object.fromEntries(
    Object.entries(keys).flatMap(([id, key]) => {
      const resourceKey = nonEmptyString(key)
      return id && resourceKey ? [[id, resourceKey]] : []
    }),
  )
}

function parseState(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // Some integrations double-encode the state value.
    try {
      return JSON.parse(decodeURIComponent(raw))
    } catch {
      return undefined
    }
  }
}

export function parseDriveLaunch(
  search: string | URLSearchParams,
): DriveLaunch | undefined {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search
  const rawState = params.get('state')
  if (rawState) {
    const state = record(parseState(rawState))
    if (state) {
      const action = nonEmptyString(state.action)
      if (action === 'open') {
        const ids = parseIds(state.ids)
        if (ids.length)
          return {
            action: 'open',
            ids,
            resourceKeys: parseResourceKeys(state.resourceKeys),
            userId: nonEmptyString(state.userId),
          }
      } else if (action === 'create') {
        return {
          action: 'create',
          folderId: nonEmptyString(state.folderId),
          folderResourceKey: nonEmptyString(state.folderResourceKey),
          userId: nonEmptyString(state.userId),
        }
      }
    }
  }

  // Direct parameters make hand-written links work too.
  const ids = parseIds(params.get('ids') ?? params.get('id') ?? undefined)
  if (ids.length) return { action: 'open', ids, resourceKeys: {} }
  const folderId = nonEmptyString(params.get('folderId'))
  if (folderId) return { action: 'create', folderId }
  return undefined
}
