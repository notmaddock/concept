import { LoaderCircleIcon } from 'lucide-react'

export function DocumentLoading({
  label = 'Opening document…',
}: {
  label?: string
}) {
  return (
    <div
      role="status"
      className="flex min-h-64 w-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground"
    >
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-5 animate-spin motion-reduce:animate-none"
      />
      <span>{label}</span>
    </div>
  )
}
