import { useRef } from 'react'
import { FolderOpenIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function DocumentFilePicker({
  label,
  accept,
  description,
  reading,
  status,
  onSelect,
}: {
  label: string
  accept: string
  description: string
  reading: boolean
  status: string
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="grid justify-items-start gap-3 rounded-xl border border-dashed p-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Choose a document</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button
        variant="outline"
        disabled={reading}
        onClick={() => inputRef.current?.click()}
      >
        <FolderOpenIcon /> Browse files
      </Button>
      <input
        ref={inputRef}
        hidden
        type="file"
        aria-label={label}
        accept={accept}
        disabled={reading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onSelect(file)
        }}
      />
      {reading && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}
