import './tables.css'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { InsertTablePlugin } from './InsertTablePlugin'
import { TableActionsPlugin } from './TableActionsPlugin'

export function TableControlsPlugin() {
  return useLexicalEditable() ? (
    <>
      <InsertTablePlugin />
      <TableActionsPlugin />
    </>
  ) : null
}
