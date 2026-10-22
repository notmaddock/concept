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
  expect(menuActions).toHaveLength(15)
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
  navigation.options.find((option) => option.id === 'page-setup')?.onSelect()
  navigation.options.find((option) => option.id === 'theme-dark')?.onSelect()
  expect(onCreate).toHaveBeenCalledOnce()
  navigation.options.find((option) => option.id === 'details')?.onSelect()
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
  for (const id of ['open', 'make-copy', 'share', 'download']) {
    await navigation.options.find((option) => option.id === id)?.onSelect()
  }
  expect(onOpen).toHaveBeenCalledOnce()
  expect(onCopy).toHaveBeenCalledOnce()
  expect(onShare).toHaveBeenCalledOnce()
  expect(onDownload).toHaveBeenCalledOnce()
  await render(false, false)
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
