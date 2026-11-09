import { useSyncExternalStore } from 'react'
import type { ActionShortcut as Shortcut } from './document-navigation-options'
import { Kbd, KbdGroup } from '#/components/ui/kbd'

const subscribe = () => () => {}
export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function ActionShortcut({ shortcut }: { shortcut?: Shortcut }) {
  const mac = useSyncExternalStore(subscribe, isMac, () => false)
  if (!shortcut) return null
  const keys = (mac && shortcut.macKeys) || shortcut.keys
  return (
    <KbdGroup className="ml-auto shrink-0 pl-3" aria-label={keys.join('+')}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
