import { lazy, Suspense, useEffect, useState } from 'react'
import { SKIP_DOM_SELECTION_TAG } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getPageSetup,
  $setPageSetup,
  DEFAULT_PAGE_SETUP,
  pageDimensions,
} from '#/lib/documents/page-setup'
import { applyPageLayout } from '#/components/nova/pages/page-layout'
import { DocumentLoading } from '../status/DocumentLoading'
import type { PageSetup } from '#/lib/documents/page-setup'

function sameSetup(first: PageSetup, second: PageSetup) {
  return (
    first === second ||
    (first.mode === second.mode &&
      first.size === second.size &&
      first.orientation === second.orientation &&
      first.width === second.width &&
      first.height === second.height &&
      first.margins.top === second.margins.top &&
      first.margins.right === second.margins.right &&
      first.margins.bottom === second.margins.bottom &&
      first.margins.left === second.margins.left)
  )
}

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
  const [editor] = useLexicalComposerContext()
  const [setup, setSetup] = useState(DEFAULT_PAGE_SETUP)
  useEffect(() => {
    let appliedSetup: PageSetup | undefined
    let appliedSheet: HTMLElement | null = null
    const update = () => {
      const value = editor.getEditorState().read($getPageSetup)
      setSetup((current) => (sameSetup(current, value) ? current : value))
      const root = editor.getRootElement()
      const sheet = root?.closest<HTMLElement>('[data-document-sheet]')
      if (!root || !sheet) return
      if (
        sheet === appliedSheet &&
        appliedSetup &&
        sameSetup(appliedSetup, value)
      )
        return
      appliedSetup = value
      appliedSheet = sheet
      applyPageLayout(sheet, value)
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
