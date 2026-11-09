import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { setupTestRoot } from '#/test/react-test'
import { TooltipProvider } from '#/components/ui/tooltip'
import { publishDocumentTheme } from '#/lib/documents/document-theme'
import { DocumentThemeButton } from './DocumentThemeButton'
import { selectDocumentTheme } from './select-document-theme'

const workspace = vi.hoisted(() => {
  const document:
    | { id: string; readOnly?: boolean; drive?: { readOnly?: boolean } }
    | undefined = { id: 'doc' }
  return { document, editorRef: { current: {} } }
})

vi.mock('../document-workspace-context', () => ({
  useDocumentWorkspace: () => workspace,
}))
vi.mock('#/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('./select-document-theme', () => ({
  selectDocumentTheme: vi.fn(),
}))

const harness = setupTestRoot()

beforeEach(() => {
  vi.clearAllMocks()
  workspace.document = { id: 'doc' }
  publishDocumentTheme('doc', 'paper')
})

function render() {
  return act(() =>
    harness.root.render(
      <TooltipProvider>
        <DocumentThemeButton />
      </TooltipProvider>,
    ),
  )
}

function trigger() {
  return harness.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Document theme"]',
  )!
}

function themeCard(label: string) {
  return document.body.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!
}

it('opens the chooser and marks the active theme', async () => {
  await render()
  expect(trigger()).not.toBeNull()
  await act(() => trigger().click())
  expect(themeCard('Paper').getAttribute('aria-pressed')).toBe('true')
  expect(themeCard('Ocean').getAttribute('aria-pressed')).toBe('false')

  await act(() => publishDocumentTheme('doc', 'ocean'))
  expect(themeCard('Paper').getAttribute('aria-pressed')).toBe('false')
  expect(themeCard('Ocean').getAttribute('aria-pressed')).toBe('true')
})

it('applies a theme from the chooser', async () => {
  await render()
  await act(() => trigger().click())
  await act(() => themeCard('Space').click())
  expect(selectDocumentTheme).toHaveBeenCalledWith(
    workspace.editorRef.current,
    'space',
    false,
  )
})

it('disables the chooser on read-only documents', async () => {
  workspace.document = { id: 'doc', readOnly: true }
  await render()
  expect(trigger().disabled).toBe(true)
})
