import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentWorkspace } from './DocumentWorkspace'

const state = vi.hoisted(() => ({
  access: { kind: 'editor', checkedAt: 1 },
  recoveryOnly: false,
  missing: false,
  retry: vi.fn(),
  detached: vi.fn(),
  recover: vi.fn(),
  recheck: vi.fn(),
}))
vi.mock('./document-workspace-context', () => ({
  DocumentWorkspaceProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useDocumentWorkspace: () => ({
    documents: [],
    loaded: true,
    retryOpen: state.retry,
    document: state.missing
      ? undefined
      : {
          id: 'Gshared',
          name: 'Shared',
          drive: { fileId: 'shared', recoveryOnly: state.recoveryOnly },
        },
    saveStatus: { phase: 'synced', access: state.access },
    recoverLocalCopy: state.recover,
    recheckAccess: state.recheck,
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('./DocumentEditor', async () => {
  const { useEffect } = await import('react')
  return {
    DocumentEditor: () => {
      useEffect(
        () => () => {
          state.detached()
        },
        [],
      )
      return <div data-shared-editor />
    },
  }
})
vi.mock('./DocumentNavigation', () => ({ DocumentNavigation: () => null }))
vi.mock('./list/DocumentList', () => ({ DocumentList: () => null }))
vi.mock('./dialogs/ProvidersDialog', () => ({ ProvidersDialog: () => null }))
vi.mock('./status/DocumentSaveStatus', () => ({
  DocumentSaveStatus: () => null,
}))
vi.mock('#/components/app-toaster', () => ({ AppToaster: () => null }))

let dispose: (() => Promise<void>) | undefined

afterEach(async () => {
  await dispose?.()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('detaches shared content on confirmed access loss and offers explicit recovery', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  await act(async () => root.render(<DocumentWorkspace id="Gshared" />))
  expect(container.querySelector('[data-shared-editor]')).not.toBeNull()
  state.access = { kind: 'unavailable', checkedAt: 2 }
  await act(async () => root.render(<DocumentWorkspace id="Gshared" />))
  expect(state.detached).toHaveBeenCalledOnce()
  expect(container.querySelector('[data-shared-editor]')).toBeNull()
  const recover = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Recover local copy',
  )!
  await act(async () => recover.click())
  expect(state.recover).toHaveBeenCalledOnce()
  expect(state.recheck).not.toHaveBeenCalled()
  state.access = { kind: 'editor', checkedAt: 3 }
  state.recoveryOnly = true
  await act(async () => root.render(<DocumentWorkspace id="Gshared" />))
  expect(container.querySelector('[data-shared-editor]')).toBeNull()
  expect(container.textContent).toContain('Retained local work')
  expect(container.textContent).not.toContain('Check access')
  state.missing = true
  await act(async () => root.render(<DocumentWorkspace id="Gshared" />))
  expect(container.textContent).toContain('Shared document unavailable')
  expect(container.textContent).not.toContain('Google Drive requires selecting')
  expect(container.textContent).toContain('Connect Drive for private access')
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Try again',
  )!
  await act(async () => retry.click())
  expect(state.retry).toHaveBeenCalledOnce()
})
