import { cn } from '#/lib/utils'
import { GripVerticalIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

interface DragPluginMenuComponentProps extends ComponentProps<'div'> {}

export function DragPluginMenuComponent({
  className,
  ...props
}: DragPluginMenuComponentProps) {
  return (
    <div
      {...props}
      className={cn(
        className,
        'cursor-pointer text-muted-foreground text-md p-2 will-change-transform will-change-opacity active:cursor-grabbing opacity-0',
      )}
      style={{
        transition: 'transform 100ms ease-in-out, opacity 150ms ease-in-out',
      }}
    >
      <GripVerticalIcon size={'1em'} />
    </div>
  )
}
