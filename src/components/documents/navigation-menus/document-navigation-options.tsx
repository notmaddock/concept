import {
  CopyIcon,
  DownloadIcon,
  FileDownIcon,
  FileTextIcon,
  FileTypeIcon,
  FolderOpenIcon,
  InfoIcon,
  LetterTextIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  PrinterIcon,
  Settings2Icon,
  Share2Icon,
  SunIcon,
} from 'lucide-react'
import { useTheme } from '#/components/theme-provider'

type NavigationContext = {
  onPageSetup: () => void
  onCreate: () => Promise<void>
  creating: boolean
  theme: ReturnType<typeof useTheme>['theme']
  setTheme: ReturnType<typeof useTheme>['setTheme']
}

type ActionDefinition = {
  id: string
  label: string
  menuLabel?: string
  keywords: string[]
  icon: typeof PlusIcon
  focusAfterSelect: 'editor' | 'action'
  onSelect: (context: NavigationContext) => void | Promise<void>
  disabled?: (context: NavigationContext) => boolean
  checked?: (context: NavigationContext) => boolean
  separatorBefore?: boolean
}

type SubmenuDefinition = {
  id: string
  label: string
  icon: typeof PlusIcon
  children: MenuItemDefinition[]
}

type MenuItemDefinition = ActionDefinition | SubmenuDefinition

type MenuDefinition = {
  label: string
  items: MenuItemDefinition[]
}

export const documentNavigation: MenuDefinition[] = [
  {
    label: 'File',
    items: [
      {
        id: 'new-document',
        label: 'New document',
        keywords: ['create'],
        icon: PlusIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onCreate(),
        disabled: (context) => context.creating,
      },
      {
        id: 'open',
        label: 'Open',
        keywords: ['open file'],
        icon: FolderOpenIcon,
        focusAfterSelect: 'action',
        onSelect: () => {},
      },
      {
        id: 'make-copy',
        label: 'Make a copy',
        keywords: ['duplicate'],
        icon: CopyIcon,
        focusAfterSelect: 'action',
        onSelect: () => {},
      },
      {
        id: 'share',
        label: 'Share',
        keywords: [],
        icon: Share2Icon,
        focusAfterSelect: 'action',
        onSelect: () => {},
        separatorBefore: true,
      },
      {
        id: 'download',
        label: 'Download',
        keywords: [],
        icon: DownloadIcon,
        focusAfterSelect: 'action',
        onSelect: () => {},
      },
      {
        id: 'export',
        label: 'Export as...',
        icon: FileDownIcon,
        children: [
          {
            id: 'export-pdf',
            label: 'Export as PDF',
            menuLabel: 'PDF (.pdf)',
            keywords: ['download'],
            icon: FileTypeIcon,
            focusAfterSelect: 'action',
            onSelect: () => {},
          },
          {
            id: 'export-word',
            label: 'Export as Word',
            menuLabel: 'Word (.docx)',
            keywords: ['docx'],
            icon: FileTextIcon,
            focusAfterSelect: 'action',
            onSelect: () => {},
          },
          {
            id: 'export-markdown',
            label: 'Export as Markdown',
            menuLabel: 'Markdown (.md)',
            keywords: ['md'],
            icon: LetterTextIcon,
            focusAfterSelect: 'action',
            onSelect: () => {},
          },
          {
            id: 'export-text',
            label: 'Export as plain text',
            menuLabel: 'Plain text (.txt)',
            keywords: ['txt'],
            icon: FileTextIcon,
            focusAfterSelect: 'action',
            onSelect: () => {},
          },
        ],
      },
      {
        id: 'details',
        label: 'Details',
        keywords: ['document information'],
        icon: InfoIcon,
        focusAfterSelect: 'action',
        onSelect: () => {},
        separatorBefore: true,
      },
      {
        id: 'page-setup',
        label: 'Page setup',
        keywords: ['paper', 'margins'],
        icon: Settings2Icon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onPageSetup(),
      },
      {
        id: 'print',
        label: 'Print',
        keywords: [],
        icon: PrinterIcon,
        focusAfterSelect: 'action',
        onSelect: () => {},
      },
    ],
  },
  { label: 'Edit', items: [] },
  {
    label: 'View',
    items: [
      {
        id: 'theme',
        label: 'Theme',
        icon: PaletteIcon,
        children: [
          {
            id: 'theme-light',
            label: 'Light theme',
            menuLabel: 'Light',
            keywords: ['appearance'],
            icon: SunIcon,
            focusAfterSelect: 'editor',
            onSelect: (context) => context.setTheme('light'),
            checked: (context) => context.theme === 'light',
          },
          {
            id: 'theme-dark',
            label: 'Dark theme',
            menuLabel: 'Dark',
            keywords: ['appearance'],
            icon: MoonIcon,
            focusAfterSelect: 'editor',
            onSelect: (context) => context.setTheme('dark'),
            checked: (context) => context.theme === 'dark',
          },
          {
            id: 'theme-system',
            label: 'System theme',
            menuLabel: 'System',
            keywords: ['appearance', 'automatic'],
            icon: MonitorIcon,
            focusAfterSelect: 'editor',
            onSelect: (context) => context.setTheme('system'),
            checked: (context) => context.theme === 'system',
          },
        ],
      },
    ],
  },
  { label: 'Insert', items: [] },
  { label: 'Format', items: [] },
  { label: 'Tools', items: [] },
  { label: 'Help', items: [] },
]

export type NavigationOption = Omit<
  ActionDefinition,
  'onSelect' | 'disabled' | 'checked'
> & {
  group: string
  onSelect: () => void | Promise<void>
  disabled?: boolean
  checked?: boolean
}

export type NavigationMenuItem =
  | NavigationOption
  | (Omit<SubmenuDefinition, 'children'> & {
      children: NavigationMenuItem[]
    })

export function useDocumentNavigationOptions(
  props: Pick<NavigationContext, 'onPageSetup' | 'onCreate' | 'creating'>,
) {
  const context: NavigationContext = { ...props, ...useTheme() }
  const options: NavigationOption[] = []

  function bindItem(
    item: MenuItemDefinition,
    group: string,
  ): NavigationMenuItem {
    if ('children' in item) {
      return {
        ...item,
        children: item.children.map((child) => bindItem(child, group)),
      }
    }

    const option: NavigationOption = {
      ...item,
      group,
      onSelect: () => item.onSelect(context),
      disabled: item.disabled?.(context),
      checked: item.checked?.(context),
    }
    options.push(option)
    return option
  }

  const menus = documentNavigation.map((menu) => ({
    label: menu.label,
    items: menu.items.map((item) => bindItem(item, menu.label)),
  }))

  return { menus, options }
}
