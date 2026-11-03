import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { NavigationMenuItem } from './document-navigation-options'
import { useDocumentNavigationOptions } from './document-navigation-options'

const theme = vi.hoisted(() => ({ theme: 'light', setTheme: vi.fn() }))
vi.mock('#/components/theme-provider', () => ({ useTheme: () => theme }))

const workspace = vi.hoisted(() => ({
  enabled: true,
  creating: false,
  createDocument: vi.fn<() => Promise<void>>(),
  openPageSetup: vi.fn(),
  openDocument: vi.fn(),
  copyDocument: vi.fn(),
  shareDocument: vi.fn(),
  showDetails: vi.fn(),
  downloadDocument: vi.fn(),
  saveToDrive: vi.fn(),
  exportDocument: vi.fn(),
}))
vi.mock('../document-workspace-context', () => ({
  useDocumentWorkspace: () => workspace,
}))

let root: Root
let container: HTMLDivElement
let navigation: ReturnType<typeof useDocumentNavigationOptions>
const {
  createDocument: onCreate,
  openPageSetup: onPageSetup,
  openDocument: onOpen,
  copyDocument: onCopy,
  shareDocument: onShare,
  downloadDocument: onDownload,
} = workspace

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  onCreate.mockResolvedValue(undefined)
  theme.theme = 'light'
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
})

async function render(creating = false, enabled = true) {
  workspace.creating = creating
  workspace.enabled = enabled
  function Harness() {
    navigation = useDocumentNavigationOptions()
    return null
  }
  await act(() => root.render(<Harness />))
}

function leaves(items: NavigationMenuItem[]): NavigationMenuItem[] {
  return items.flatMap((item) =>
    'children' in item ? leaves(item.children) : [item],
  )
}

it('exposes every menu action to search with the same state and handler', async () => {
  await render()
  const menuActions = navigation.menus.flatMap((menu) => leaves(menu.items))
  expect(menuActions.length).toBeGreaterThan(100)
  expect(
    navigation.menus.find((menu) => menu.label === 'Format')?.items,
  ).toHaveLength(13)

  expect(navigation.options).toHaveLength(menuActions.length)
  for (const [index, option] of navigation.options.entries()) {
    expect(option).toBe(menuActions[index])
  }
  expect(navigation.options.some((option) => option.id === 'theme')).toBe(false)
  expect(navigation.options.some((option) => option.id === 'export')).toBe(
    false,
  )

  await navigation.options
    .find((option) => option.id === 'new-document')
    ?.onSelect()
  await navigation.options
    .find((option) => option.id === 'page-setup')
    ?.onSelect()
  await navigation.options
    .find((option) => option.id === 'theme-dark')
    ?.onSelect()
  expect(onCreate).toHaveBeenCalledOnce()
  await navigation.options.find((option) => option.id === 'details')?.onSelect()
  expect(workspace.showDetails).toHaveBeenCalledOnce()
  expect(onPageSetup).toHaveBeenCalledOnce()
  expect(theme.setTheme).toHaveBeenCalledWith('dark')
})

it('updates creation availability and selected theme in both consumers', async () => {
  await render()
  expect(
    navigation.options.find((option) => option.id === 'new-document')?.disabled,
  ).toBe(false)
  expect(
    navigation.options.find((option) => option.id === 'theme-light')?.checked,
  ).toBe(true)

  theme.theme = 'dark'
  await render(true)
  expect(
    navigation.options.find((option) => option.id === 'new-document')?.disabled,
  ).toBe(true)
  expect(
    navigation.options.find((option) => option.id === 'theme-light')?.checked,
  ).toBe(false)
  expect(
    navigation.options.find((option) => option.id === 'theme-dark')?.checked,
  ).toBe(true)
})

it('connects file actions to their handlers and keeps Open available without a document', async () => {
  await render()
  for (const id of [
    'open',
    'save-to-drive',
    'make-copy',
    'share',
    'download',
  ]) {
    await navigation.options.find((option) => option.id === id)?.onSelect()
  }
  expect(onOpen).toHaveBeenCalledOnce()
  expect(onCopy).toHaveBeenCalledOnce()
  expect(onShare).toHaveBeenCalledOnce()
  expect(onDownload).toHaveBeenCalledOnce()
  expect(workspace.saveToDrive).toHaveBeenCalledOnce()
  await render(false, false)
  expect(
    navigation.options.find((option) => option.id === 'save-to-drive')
      ?.disabled,
  ).toBe(true)
  expect(
    navigation.options.find((option) => option.id === 'open')?.disabled,
  ).toBe(false)
  expect(
    navigation.options.find((option) => option.id === 'make-copy')?.disabled,
  ).toBe(true)
  expect(
    navigation.options.find((option) => option.id === 'download')?.disabled,
  ).toBe(true)
})

it.each(['print', 'export-pdf'])(
  'opens the document print dialog for %s',
  async (id) => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await render()
    await navigation.options.find((option) => option.id === id)?.onSelect()
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  },
)

it('shares edit shortcuts with menus and action search', async () => {
  await render()
  const edit = navigation.menus.find((menu) => menu.label === 'Edit')!
  expect(edit.items).toHaveLength(9)
  for (const item of edit.items) {
    if ('children' in item) continue
    expect(item.shortcut?.keys.length).toBeGreaterThan(0)
    expect(
      navigation.options.find((option) => option.id === item.id)?.shortcut,
    ).toBe(item.shortcut)
  }
  expect(
    navigation.options.find((option) => option.id === 'redo')?.shortcut,
  ).toEqual({ keys: ['Ctrl', 'Y'], macKeys: ['⌘', 'Shift', 'Z'] })
})

it('connects export actions and disables unsupported Word export', async () => {
  await render()
  for (const format of ['text', 'markdown', 'html']) {
    await navigation.options
      .find((option) => option.id === `export-${format}`)
      ?.onSelect()
    expect(workspace.exportDocument).toHaveBeenCalledWith(format)
  }
  expect(
    navigation.options.find((option) => option.id === 'export-word')?.disabled,
  ).toBe(true)
})

it('disables submenu parents when all their children are disabled', async () => {
  await render(false, false)
  const file = navigation.menus.find((menu) => menu.label === 'File')!
  expect(file.items.find((item) => item.id === 'export')?.disabled).toBe(true)
  expect(file.items.find((item) => item.id === 'import')?.disabled).toBe(false)
  await render()
  const enabledFile = navigation.menus.find((menu) => menu.label === 'File')!
  expect(enabledFile.items.find((item) => item.id === 'export')?.disabled).toBe(
    false,
  )
  expect(
    navigation.options.find((option) => option.id === 'export-pdf')?.menuLabel,
  ).toBe('PDF (.pdf)')
})

it('binds editor actions supplied by the lazy editor navigation', async () => {
  workspace.enabled = true
  const edit = { run: vi.fn(), disabled: () => false }
  const format = {
    run: vi.fn(),
    disabled: false,
    checked: () => true,
  }
  function Harness() {
    navigation = useDocumentNavigationOptions({ edit, format })
    return null
  }
  await act(() => root.render(<Harness />))
  const undo = navigation.options.find((option) => option.id === 'undo')!
  expect(undo.disabled).toBe(false)
  await undo.onSelect()
  expect(edit.run).toHaveBeenCalledWith('undo')
  const bold = navigation.options.find((option) => option.id === 'format-bold')!
  expect(bold.checked).toBe(true)
  expect(bold.disabled).toBe(false)
  await bold.onSelect()
  expect(format.run).toHaveBeenCalledWith({ kind: 'text', value: 'bold' })
})
