import { useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { maxTableColumns, maxTableRows } from './table-commands'

const gridRows = 8
const gridColumns = 10
const rows = Array.from({ length: gridRows }, (_, index) => index + 1)
const columns = Array.from({ length: gridColumns }, (_, index) => index + 1)
const defaultSize = { rows: '3', columns: '3' }

type GridCell = { rows: number; columns: number }

export function TableDimensionsPicker({
  rowsInput,
}: {
  rowsInput: RefObject<HTMLInputElement | null>
}) {
  const [size, setSize] = useState(defaultSize)
  const [preview, setPreview] = useState<GridCell | null>(null)
  const [focused, setFocused] = useState<GridCell>({ rows: 3, columns: 3 })
  const grid = useRef<HTMLDivElement>(null)

  const chosenRows = Number(size.rows)
  const chosenColumns = Number(size.columns)

  function move(
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number,
  ) {
    const supported = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
    ]
    if (!supported.includes(event.key)) return
    event.preventDefault()
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const rowsDelta =
      Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp')
    const columnsDelta =
      (Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft')) *
      (rtl ? -1 : 1)
    const nextRow = Math.min(gridRows, Math.max(1, row + rowsDelta))
    const nextColumn =
      event.key === 'Home'
        ? 1
        : event.key === 'End'
          ? gridColumns
          : Math.min(gridColumns, Math.max(1, column + columnsDelta))
    grid.current
      ?.querySelector<HTMLButtonElement>(
        `[data-row="${nextRow}"][data-column="${nextColumn}"]`,
      )
      ?.focus()
  }

  return (
    <>
      <input type="hidden" name="rows" value={size.rows} />
      <input type="hidden" name="columns" value={size.columns} />
      <div
        ref={grid}
        role="grid"
        aria-label="Table dimensions"
        className="hidden gap-1.5 [@media(min-width:48rem)_and_(hover:hover)_and_(pointer:fine)]:grid"
        onPointerLeave={() => setPreview(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPreview(null)
        }}
      >
        {rows.map((row) => (
          <div key={row} role="row" className="grid grid-cols-10 gap-1.5">
            {columns.map((column) => {
              const selected = row <= chosenRows && column <= chosenColumns
              const pointed =
                preview && row <= preview.rows && column <= preview.columns
              return (
                <button
                  key={column}
                  type="button"
                  role="gridcell"
                  aria-label={`${row} ${row === 1 ? 'row' : 'rows'} by ${column} ${column === 1 ? 'column' : 'columns'}`}
                  aria-selected={selected}
                  data-row={row}
                  data-column={column}
                  data-preview={pointed ? 'true' : undefined}
                  tabIndex={
                    focused.rows === row && focused.columns === column ? 0 : -1
                  }
                  className={cn(
                    'aspect-square rounded-sm border border-border bg-background focus-visible:z-1 focus-visible:outline-2 focus-visible:outline-ring',
                    selected && !preview && 'border-primary bg-primary/30',
                    pointed && 'border-primary bg-primary/15',
                  )}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch')
                      setPreview({ rows: row, columns: column })
                  }}
                  onFocus={() => {
                    setFocused({ rows: row, columns: column })
                    setPreview({ rows: row, columns: column })
                  }}
                  onKeyDown={(event) => move(event, row, column)}
                  onClick={() => {
                    setSize({ rows: String(row), columns: String(column) })
                    setPreview(null)
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="grid gap-2 font-medium">
          Rows
          <Input
            ref={rowsInput}
            type="number"
            min={1}
            max={maxTableRows}
            value={preview?.rows ?? size.rows}
            onFocus={() => setPreview(null)}
            onChange={(event) => setSize({ ...size, rows: event.target.value })}
            required
          />
        </label>
        <label className="grid gap-2 font-medium">
          Columns
          <Input
            type="number"
            min={1}
            max={maxTableColumns}
            value={preview?.columns ?? size.columns}
            onFocus={() => setPreview(null)}
            onChange={(event) =>
              setSize({ ...size, columns: event.target.value })
            }
            required
          />
        </label>
      </div>
    </>
  )
}
