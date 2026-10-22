import { $getSelection, $isRangeSelection, HISTORY_PUSH_TAG } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $patchStyleText } from '@lexical/selection'

export function stepFontSize(editor: LexicalEditor, delta: number) {
  editor.update(
    () => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      $patchStyleText(selection, {
        'font-size': (value, target) => {
          const element = !$isRangeSelection(target)
            ? (editor.getElementByKey(target.getKey()) ??
              editor.getElementByKey(target.getParent()?.getKey() ?? ''))
            : null
          const pixels = parseFloat(
            getComputedStyle(element ?? editor.getRootElement()!).fontSize,
          )
          const points = value?.endsWith('pt')
            ? parseFloat(value)
            : value?.endsWith('px')
              ? parseFloat(value) * 0.75
              : pixels * 0.75
          return `${Math.min(200, Math.max(1, Math.round((points + delta) * 100) / 100))}pt`
        },
      })
    },
    { tag: HISTORY_PUSH_TAG },
  )
  editor.focus()
}
