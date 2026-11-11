import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#/components/ui/dialog'
import { PAGE_SIZES, pageSetupError } from '#/lib/documents/page-setup'
import type { PageSetup } from '#/lib/documents/page-setup'

export function PageSetupDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: PageSetup
  onApply: (value: PageSetup) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Page setup</DialogTitle>
          <DialogDescription>
            Choose your document layout. Settings sync with this document.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PageSetupForm
            initialValue={value}
            onCancel={() => onOpenChange(false)}
            onApply={(nextValue) => {
              onApply(nextValue)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PageSetupForm({
  initialValue,
  onApply,
  onCancel,
}: {
  initialValue: PageSetup
  onApply: (value: PageSetup) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialValue)
  const [unit, setUnit] = useState('mm')
  const id = useId()
  const factor = unit === 'in' ? 25.4 : unit === 'cm' ? 10 : 1
  const error = pageSetupError(draft)
  function numberField(
    label: string,
    value: number,
    update: (value: number) => void,
  ) {
    return (
      <label className="grid gap-1" key={label}>
        {label} ({unit})
        <Input
          type="number"
          min={0}
          step="0.1"
          value={Number.isNaN(value) ? '' : Number((value / factor).toFixed(4))}
          onChange={(event) =>
            update(
              event.target.value === ''
                ? NaN
                : Number(event.target.value) * factor,
            )
          }
        />
      </label>
    )
  }
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!error) onApply(draft)
      }}
    >
      <PageSetupSelect
        label="Paper size"
        value={draft.mode === 'pageless' ? 'pageless' : draft.size}
        items={[
          { value: 'pageless', label: 'Pageless' },
          ...Object.entries(PAGE_SIZES).map(([name, [width, height]]) => ({
            value: name,
            label: `${name} (${width} × ${height} mm)`,
          })),
          { value: 'custom', label: 'Custom' },
        ]}
        onChange={(selectedValue) =>
          setDraft(
            selectedValue === 'pageless'
              ? { ...draft, mode: 'pageless' }
              : {
                  ...draft,
                  mode: 'paper',
                  size: selectedValue as PageSetup['size'],
                },
          )
        }
      />
      {draft.mode === 'pageless' ? (
        <p className="text-muted-foreground">
          A flexible, continuous writing canvas without paper boundaries.
        </p>
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-2">Orientation</legend>
            <div className="flex gap-2">
              {(['portrait', 'landscape'] as const).map((orientation) => (
                <Button
                  key={orientation}
                  type="button"
                  variant={
                    draft.orientation === orientation ? 'secondary' : 'outline'
                  }
                  aria-pressed={draft.orientation === orientation}
                  onClick={() => setDraft({ ...draft, orientation })}
                >
                  {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2">Units</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'mm', label: 'Millimeters' },
                { value: 'cm', label: 'Centimeters' },
                { value: 'in', label: 'Inches' },
              ].map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  variant={unit === value ? 'secondary' : 'outline'}
                  aria-pressed={unit === value}
                  onClick={() => setUnit(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          {draft.size === 'custom' && (
            <div className="grid grid-cols-2 gap-4">
              {numberField('Paper width', draft.width, (width) =>
                setDraft({ ...draft, width }),
              )}
              {numberField('Paper height', draft.height, (height) =>
                setDraft({ ...draft, height }),
              )}
            </div>
          )}
          <fieldset className="grid gap-3">
            <legend className="mb-2 font-medium">Margins</legend>
            <PageSetupSelect
              label="Preset"
              value={
                MARGIN_PRESETS.find((preset) =>
                  Object.values(draft.margins).every(
                    (margin) => Math.abs(margin - preset.mm) < 0.0001,
                  ),
                )?.value ?? 'custom'
              }
              items={[{ value: 'custom', label: 'Custom' }, ...MARGIN_PRESETS]}
              onChange={(selectedValue) => {
                const preset = MARGIN_PRESETS.find(
                  (item) => item.value === selectedValue,
                )
                if (preset)
                  setDraft({
                    ...draft,
                    margins: {
                      top: preset.mm,
                      right: preset.mm,
                      bottom: preset.mm,
                      left: preset.mm,
                    },
                  })
              }}
            />
            <div className="grid grid-cols-2 gap-4">
              {(['top', 'bottom', 'left', 'right'] as const).map((side) =>
                numberField(
                  side[0].toUpperCase() + side.slice(1),
                  draft.margins[side],
                  (value) =>
                    setDraft({
                      ...draft,
                      margins: { ...draft.margins, [side]: value },
                    }),
                ),
              )}
            </div>
          </fieldset>
        </>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          Apply
        </Button>
      </DialogFooter>
    </form>
  )
}

const MARGIN_PRESETS = [
  { value: 'narrow', label: 'Narrow (0.5 in)', mm: 12.7 },
  { value: 'normal', label: 'Normal (1 in)', mm: 25.4 },
  { value: 'moderate', label: 'Moderate (1.5 in)', mm: 38.1 },
  { value: 'wide', label: 'Wide (2 in)', mm: 50.8 },
]

function PageSetupSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>{label}</label>
      <Select
        value={value}
        items={items}
        onValueChange={(next) => {
          if (next !== null) onChange(next)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
