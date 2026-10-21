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

  const isOnMenu = () => false

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElement}
      isOnMenu={isOnMenu}
      menuRef={menuComponentRef}
      menuComponent={
        <DragPluginMenuComponent
          ref={menuComponentRef}
          className="absolute top-0 left-6"
        />
      }
      targetLineRef={targetLineRef}
      targetLineComponent={
        <DragPluginTargetLineComponent targetLineRef={targetLineRef} />
      }
    />
  )
}
