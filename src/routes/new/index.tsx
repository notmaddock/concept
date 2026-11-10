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
import { createBlankDriveDocument } from '#/lib/documents/drive/create'
import { parseDriveLaunch } from '#/lib/documents/drive/launch'

export const Route = createFileRoute('/new/')({
  component: NewDocumentRoute,
})

function NewDocumentRoute() {
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const navigate = useNavigate()
  const launch = useMemo(() => parseDriveLaunch(searchStr), [searchStr])
  const [error, setError] = useState<string>()
  const [needsConnection, setNeedsConnection] = useState(false)
  const started = useRef(false)

  const create = useCallback(async () => {
    if (launch?.action === 'open') return
    setError(undefined)
    setNeedsConnection(false)
    try {
      if (launch?.action === 'create') {
        await prepareGoogleDriveAuth()
        if (!isGoogleDriveConnected()) {
          await connectGoogleDrive()
          return
        }
        const file = await createBlankDriveDocument({
          folderId: launch.folderId,
          folderResourceKey: launch.folderResourceKey,
        })
        await navigate({
          to: '/',
          hash: documentHash(`G${file.id}`),
          replace: true,
        })
        return
      }
      const created = await documentStorage.create()
      await navigate({
        to: '/',
        hash: documentHash(created.id),
        replace: true,
      })
    } catch (cause) {
      setNeedsConnection(
        launch?.action === 'create' &&
          (!isGoogleDriveConnected() || isGoogleDriveAuthError(cause)),
      )
      setError(describeCreateError(cause))
    }
  }, [launch, navigate])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void create()
  }, [create])

  if (launch?.action === 'open')
    return (
      <DriveLaunchError
        title="Open from Google Drive"
        description="This link opens an existing document. Continue to open it."
      >
        <Button nativeButton={false} render={<a href={`/open${searchStr}`} />}>
          Open document
        </Button>
      </DriveLaunchError>
    )

  if (error)
    return (
      <DriveLaunchError title="Couldn’t create a document" description={error}>
        {needsConnection ? (
          <Button onClick={() => void create()}>
            <DriveIcon className="size-4" /> Reconnect Google Drive
          </Button>
        ) : (
          <Button onClick={() => void create()}>Try again</Button>
        )}
      </DriveLaunchError>
    )

  return (
    <DriveLaunchLoading
      label={
        launch?.action === 'create'
          ? 'Creating document in Google Drive…'
          : 'Creating document…'
      }
    />
  )
}

function describeCreateError(cause: unknown) {
  if (isGoogleDriveAuthError(cause))
    return 'Reconnect Google Drive to create this document.'
  if (
    cause instanceof DriveError &&
    (cause.status === 403 || cause.status === 404)
  )
    return 'Google Drive didn’t allow creating a document in that folder. Try creating it from My Drive.'
  return cause instanceof Error
    ? cause.message
    : 'Could not create the document.'
}
