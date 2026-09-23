import type { ComponentProps, RefObject } from 'react'

type DragPluginTargetLineComponentProps = ComponentProps<'div'> & {
  targetLineRef: RefObject<HTMLDivElement | null>
}

export function DragPluginTargetLineComponent({
  targetLineRef,
}: DragPluginTargetLineComponentProps) {
  return (
    <div
      ref={targetLineRef}
      className="pointer-events-none absolute top-0 left-0 h-0.5 bg-accent-foreground opacity-0 will-change-transform"
    />
  )
}
