import type { ReactNode } from 'react'
import type { ActionShortcut as Shortcut } from './document-navigation-options'
import { ActionShortcut } from './ActionShortcut'

export function ActionLabel({
  children,
  shortcut,
}: {
  children: ReactNode
  shortcut?: Shortcut
}) {
  // A shortcut that cannot share the label's line wraps into the clipped area.
  return (
    <span className="flex h-5 min-w-0 flex-1 flex-wrap items-start overflow-hidden">
      <span className="max-w-full shrink-0 truncate leading-5">{children}</span>
      <ActionShortcut shortcut={shortcut} />
    </span>
  )
}
