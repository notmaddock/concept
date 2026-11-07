import { capabilitiesFromDrive } from './capabilities'
import type { DocumentCapabilities, DriveCapabilityFlags } from './capabilities'
import {
  clearCachedDriveTokenForUser,
  getDriveAccessTokenForUser,
} from './user-token.server'
import type { DriveVerifier } from './room'

const capabilitiesFields =
  'id,capabilities(canEdit,canModifyContent,canComment)'

/** Non-2xx Drive responses other than 403/404 (which mean "no access"). */
export class DriveRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveRequestError'
  }
}

/**
 * Fetches the caller's capabilities on a Drive file. 404/403 mean the user
 * has no access and resolve to undefined; any other failure throws.
 */
export async function fetchDriveCapabilities(
  fileId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DocumentCapabilities | undefined> {
  const response = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${capabilitiesFields}&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (response.status === 404 || response.status === 403) return undefined
  if (!response.ok)
    throw new DriveRequestError(
      response.status,
      `Drive files.get failed with status ${response.status}.`,
    )
  const body = (await response.json()) as {
    capabilities?: DriveCapabilityFlags
  }
  return capabilitiesFromDrive(body.capabilities)
}

/**
 * Drive-backed verifier for the Durable Object: checks the user's current
 * capabilities with their own token. A 403/404 means the user genuinely has no
 * access and resolves to `undefined`. Any other failure (network, 5xx, expired
 * refresh token) throws: the caller must treat it as "could not check" rather
 * than "no access", otherwise a Drive outage would revoke every connected user.
 */
export function createDriveVerifier(
  env: Cloudflare.Env,
  origin: string,
): DriveVerifier {
  const verifyOnce = async (fileId: string, userId: string) => {
    const accessToken = await getDriveAccessTokenForUser(env, origin, userId)
    return fetchDriveCapabilities(fileId, accessToken)
  }
  return {
    async verify(fileId, userId) {
      try {
        return await verifyOnce(fileId, userId)
      } catch (error) {
        if (error instanceof DriveRequestError && error.status === 401) {
          clearCachedDriveTokenForUser(userId)
          return verifyOnce(fileId, userId)
        }
        throw error
      }
    },
  }
}
