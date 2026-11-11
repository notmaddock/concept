import { SparklesIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { useDocumentWorkspace } from './document-workspace-store'
import { APP_VERSION } from '#/version'

export function ChangelogButton() {
  const { changelogUnseen, showChangelog } = useDocumentWorkspace()
  if (!changelogUnseen) return null

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={showChangelog}
      aria-label={`What's new in Concept ${APP_VERSION}`}
    >
      <SparklesIcon />
      <span className="hidden sm:inline">What's new?</span>
    </Button>
  )
}
