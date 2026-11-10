import {
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DriveLaunchError,
  DriveLaunchLoading,
} from '#/components/documents/DriveLaunchScreen'
import { DriveIcon } from '#/components/documents/icons/DriveIcon'
import { Button } from '#/components/ui/button'
import { documentStorage } from '#/lib/documents/document-storage'
import { documentHash } from '#/lib/documents/document-url'
import { DriveError } from '#/lib/documents/drive/api'
import {
  connectGoogleDrive,
  isGoogleDriveAuthError,
  isGoogleDriveConnected,
  prepareGoogleDriveAuth,
} from '#/lib/documents/drive/auth'
import { parseDriveLaunch } from '#/lib/documents/drive/launch'
import { openGooglePicker } from '#/lib/documents/drive/picker'

export const Route = createFileRoute('/open/')({
  component: OpenFromDriveRoute,
})

function OpenFromDriveRoute() {
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const navigate = useNavigate()
  const launch = useMemo(() => parseDriveLaunch(searchStr), [searchStr])
  const [error, setError] = useState<string>()
  const [needsConnection, setNeedsConnection] = useState(false)
  const [granting, setGranting] = useState(false)
  const started = useRef(false)

  const open = useCallback(async () => {
    if (!launch || launch.action !== 'open') return
    setError(undefined)
    setNeedsConnection(false)
    try {
      await prepareGoogleDriveAuth()
      if (!isGoogleDriveConnected()) {
        await connectGoogleDrive()
        return
      }
      const id = launch.ids[0]
      await documentStorage.get(`G${id}`, launch.resourceKeys[id])
      await navigate({ to: '/', hash: documentHash(`G${id}`), replace: true })
    } catch (cause) {
      setNeedsConnection(
        !isGoogleDriveConnected() || isGoogleDriveAuthError(cause),
      )
      setError(describeOpenError(cause))
    }
  }, [launch, navigate])

  const grantAccess = useCallback(async () => {
    if (!launch || launch.action !== 'open') return
    setGranting(true)
    setError(undefined)
    try {
      const picked = await openGooglePicker({ fileId: launch.ids[0] })
      if (!picked) return
      await documentStorage.get(`G${picked.id}`, launch.resourceKeys[picked.id])
      await navigate({
        to: '/',
        hash: documentHash(`G${picked.id}`),
        replace: true,
      })
    } catch (cause) {
      setError(describeOpenError(cause))
    } finally {
      setGranting(false)
    }
  }, [launch, navigate])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void open()
  }, [open])

  if (!launch || launch.action !== 'open')
    return (
      <DriveLaunchError
        title="Open from Google Drive"
        description="This link doesn’t include a Google Drive document. Open Concept from Drive, or choose a document in the app."
      />
    )

  if (error)
    return (
      <DriveLaunchError
        title="Couldn’t open from Google Drive"
        description={error}
      >
        {needsConnection ? (
          <Button onClick={() => void open()}>
            <DriveIcon className="size-4" /> Reconnect Google Drive
          </Button>
        ) : (
          <>
            <Button onClick={() => void open()}>Try again</Button>
            <Button
              variant="outline"
              disabled={granting}
              onClick={() => void grantAccess()}
            >
              <DriveIcon className="size-4" />
              {granting ? 'Opening picker…' : 'Choose in Google Drive'}
            </Button>
          </>
        )}
      </DriveLaunchError>
    )

  return <DriveLaunchLoading label="Opening from Google Drive…" />
}

function describeOpenError(cause: unknown) {
  if (isGoogleDriveAuthError(cause))
    return 'Reconnect Google Drive to open this document.'
  if (
    cause instanceof DriveError &&
    (cause.status === 403 || cause.status === 404)
  )
    return 'Google Drive didn’t grant access to this document. Choose it in the Drive picker to grant access.'
  return cause instanceof Error
    ? cause.message
    : 'Could not open this document from Google Drive.'
}
