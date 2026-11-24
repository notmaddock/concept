import { createCommand } from 'lexical'

export type ColumnCount = 1 | 2 | 3

export const SET_COLUMN_LAYOUT_COMMAND = createCommand<ColumnCount>(
  'SET_COLUMN_LAYOUT_COMMAND',
)
