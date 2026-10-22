import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { DragPluginMenuComponent } from './DragPluginMenuComponent'
import { DragPluginTargetLineComponent } from './DragPluginTargetLineComponent'
import { useRef } from 'react'

export interface DragPluginProps {
  anchorElement: HTMLElement
}

export function DragPlugin({ anchorElement }: DragPluginProps) {
  const menuComponentRef = useRef<HTMLDivElement>(null)
  const targetLineRef = useRef<HTMLDivElement>(null)

  const isOnMenu = (element: HTMLElement) =>
    menuComponentRef.current?.contains(element) ?? false

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElement}
      isOnMenu={isOnMenu}
      menuRef={menuComponentRef}
      menuComponent={
        <DragPluginMenuComponent
          ref={menuComponentRef}
          // Reserve the 32px handle, a 12px text gap, and Lexical's 4px translation.
          className="absolute top-0 left-[calc(var(--page-margin-left,clamp(1.5rem,6vw,4rem))-3rem)]"
        />
      }
      targetLineRef={targetLineRef}
      targetLineComponent={
        <DragPluginTargetLineComponent targetLineRef={targetLineRef} />
      }
    />
  )
}
