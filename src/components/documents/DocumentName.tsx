import { useEffect, useState } from 'react'
import { Input } from '#/components/ui/input'

export function DocumentName({
  name,
  onSave,
}: {
  name: string
  onSave?: (name: string) => Promise<boolean>
}) {
  const [value, setValue] = useState(name)

  useEffect(() => {
    setValue(name)
  }, [name])

  return (
    <Input
      aria-label={onSave ? 'Document name' : 'Workspace name'}
      readOnly={!onSave}
      tabIndex={onSave ? 0 : -1}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (!onSave) return
        const draft = value
        void onSave(draft)
          .then((saved) => {
            setValue((current) =>
              current === draft ? (saved ? draft.trim() : name) : current,
            )
          })
          .catch(() => {
            setValue(name)
          })
      }}
      onKeyDown={(event) => {
        if (!onSave) return
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setValue(name)
          event.preventDefault()
        }
      }}
      className="h-8 w-auto min-w-0 max-w-md field-sizing-content border-transparent bg-transparent text-lg! shadow-none hover:border-input focus-visible:bg-background read-only:pointer-events-none"
    />
  )
}
