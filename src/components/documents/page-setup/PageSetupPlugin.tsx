import { lazy, Suspense, useEffect, useState } from 'react'
import { SKIP_DOM_SELECTION_TAG } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getPageSetup,
  $setPageSetup,
  DEFAULT_PAGE_SETUP,
  pageDimensions,
} from '#/lib/documents/page-setup'
import { afterPageLoad } from '#/lib/loading/after-page-load'
import { DocumentLoading } from '../DocumentLoading'

const loadDialog = () => import('./PageSetupDialog')
const PageSetupDialog = lazy(() =>
  loadDialog().then((module) => ({ default: module.PageSetupDialog })),
)

export function PageSetupPlugin({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  useEffect(() => afterPageLoad(loadDialog), [])
  const [editor] = useLexicalComposerContext()
  const [setup, setSetup] = useState(DEFAULT_PAGE_SETUP)
  useEffect(() => {
    const update = () => {
      const value = editor.getEditorState().read($getPageSetup)
      setSetup(value)
      const root = editor.getRootElement()
      const sheet = root?.closest<HTMLElement>('[data-document-sheet]')
      if (!root || !sheet) return
      const paper = value.mode === 'paper'
      const { width, height } = pageDimensions(value)
      sheet.style.width = paper ? `${width}mm` : '100%'
      sheet.style.maxWidth = paper ? 'none' : '960px'
      sheet.style.minHeight = paper ? `${height}mm` : '100%'
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        sheet.style.setProperty(
          `--page-margin-${side}`,
          paper
            ? `${value.margins[side]}mm`
            : side === 'top' || side === 'bottom'
              ? '2rem'
              : 'clamp(1.5rem, 6vw, 4rem)',
        )
      }
    }
    const unregisterRoot = editor.registerRootListener(update)
    const unregisterUpdate = editor.registerUpdateListener(update)
    update()
    return () => {
      unregisterRoot()
      unregisterUpdate()
    }
  }, [editor])
  const printSetup = setup.mode === 'paper' ? setup : DEFAULT_PAGE_SETUP
  const { width, height } = pageDimensions(printSetup)
  const { top, right, bottom, left } = printSetup.margins

  return (
    <>
      <style media="print">{`@page { size: ${width}mm ${height}mm; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`}</style>
      {open ? (
        <Suspense fallback={<DocumentLoading label="Loading page setup…" />}>
          <PageSetupDialog
            open={open}
            onOpenChange={onOpenChange}
            value={setup}
            onApply={(value) =>
              // Page settings must not restore editor focus while the dialog is closing.
              editor.update(() => $setPageSetup(value), {
                tag: SKIP_DOM_SELECTION_TAG,
              })
            }
          />
        </Suspense>
      ) : null}
    </>
  )
}
