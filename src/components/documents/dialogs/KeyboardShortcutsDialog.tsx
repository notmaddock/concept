import { useId, useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  editorShortcuts,
  getEditorShortcutLabels,
} from '#/components/nova/editor-shortcuts'
import { ActionShortcut, isMac } from '../navigation-menus/ActionShortcut'

const subscribe = () => () => {}
const groups = [...new Set(editorShortcuts.map((shortcut) => shortcut.group))]

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mac = useSyncExternalStore(subscribe, isMac, () => false)
  const id = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Editing shortcuts apply while the document is focused. Find uses
            your browser’s search; editing is unavailable in read-only
            documents.
          </DialogDescription>
        </DialogHeader>
        {groups.map((group, index) => (
          <section key={group} aria-labelledby={`${id}-${index}`}>
            <h3 id={`${id}-${index}`} className="mb-2 text-sm font-semibold">
              {group}
            </h3>
            <dl className="space-y-2">
              {editorShortcuts
                .filter((shortcut) => shortcut.group === group)
                .map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <dt>{shortcut.label}</dt>
                    <dd className="flex items-center gap-1">
                      {getEditorShortcutLabels(shortcut, mac).map(
                        (keys, bindingIndex) => (
                          <span
                            key={keys.join('+')}
                            className="flex items-center gap-1"
                          >
                            {bindingIndex > 0 && (
                              <span className="text-muted-foreground">or</span>
                            )}
                            <ActionShortcut shortcut={{ keys }} />
                          </span>
                        ),
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
