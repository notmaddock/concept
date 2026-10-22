import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { ColorPicker, ColorPickerPanel } from '#/components/reui/color-picker'

export function CustomColor({
  initialColor,
  onApply,
}: {
  initialColor: string | null
  onApply: (value: string) => void
}) {
  const [value, setValue] = useState<string | null>(initialColor ?? '#2563eb')
  return (
    <div className="space-y-3">
      <ColorPicker
        value={value}
        onValueChange={setValue}
        alpha
        format="rgb"
        aria-label="Custom color"
      >
        <ColorPickerPanel />
      </ColorPicker>
      <Button
        size="sm"
        className="w-full"
        disabled={!value}
        onClick={() => value && onApply(value)}
      >
        Apply color
      </Button>
    </div>
  )
}
