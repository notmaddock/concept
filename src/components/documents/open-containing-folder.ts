import { toast } from 'sonner'
import { getContainingFolderUrl } from '#/lib/documents/drive/api'

export async function openContainingFolder(fileId: string) {
  // Reserve the tab during the click so the async lookup is not popup-blocked.
  const tab = window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  try {
    if (!tab) throw new Error('Allow popups to open the containing folder.')
    tab.location.replace(await getContainingFolderUrl(fileId))
  } catch (cause) {
    tab?.close()
    toast.error(
      cause instanceof Error
        ? cause.message
        : 'Could not open the containing folder.',
      { id: 'open-containing-folder' },
    )
  }
}
