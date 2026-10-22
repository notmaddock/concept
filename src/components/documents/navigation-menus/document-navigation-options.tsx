import { toast } from 'sonner'
import { useEditActions } from './use-edit-actions'
import type { EditAction } from './use-edit-actions'
import { useDocumentWorkspace } from '../document-workspace-context'
import {
  CopyIcon,
  Undo2Icon,
  Redo2Icon,
  ScissorsIcon,
  ClipboardPasteIcon,
  ClipboardTypeIcon,
  TextSelectIcon,
  Trash2Icon,
  RemoveFormattingIcon,
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

export type ActionShortcut = {
  keys: string[]
  macKeys?: string[]
}

const editShortcuts: Record<EditAction, ActionShortcut> = {
  undo: { keys: ['Ctrl', 'Z'], macKeys: ['⌘', 'Z'] },
  redo: { keys: ['Ctrl', 'Y'], macKeys: ['⌘', 'Shift', 'Z'] },
  cut: { keys: ['Ctrl', 'X'], macKeys: ['⌘', 'X'] },
  copy: { keys: ['Ctrl', 'C'], macKeys: ['⌘', 'C'] },
  paste: { keys: ['Ctrl', 'V'], macKeys: ['⌘', 'V'] },
  'paste-plain': { keys: ['Ctrl', 'Shift', 'V'], macKeys: ['⌘', 'Shift', 'V'] },
  'select-all': { keys: ['Ctrl', 'A'], macKeys: ['⌘', 'A'] },
  'delete-selection': { keys: ['Delete'], macKeys: ['⌫'] },
  'clear-formatting': { keys: ['Ctrl', '\\'], macKeys: ['⌘', '\\'] },
}

type NavigationContext = {
  edit: ReturnType<typeof useEditActions>
  enabled?: boolean
  onOpen?: () => void
  onDetails?: () => void
  onShare: () => void
  onCopy?: () => void
  onDownload?: () => void
  onPageSetup: () => void
  onCreate: () => Promise<void>
  creating: boolean
  theme: ReturnType<typeof useTheme>['theme']
  setTheme: ReturnType<typeof useTheme>['setTheme']
}

type ActionDefinition = {
  id: string
  label: string
  shortcut?: ActionShortcut
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

function editOption(
  id: EditAction,
  label: string,
  icon: typeof PlusIcon,
  separatorBefore = false,
): ActionDefinition {
  return {
    id,
    shortcut: editShortcuts[id],
    label,
    icon,
    keywords: id === 'paste-plain' ? ['plain text', 'clipboard'] : ['edit', id],
    focusAfterSelect: 'editor',
    separatorBefore,
    onSelect: (context) => context.edit.run(id),
    disabled: (context) => context.edit.disabled(id),
  }
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
        onSelect: (context) => context.onOpen?.(),
      },
      {
        id: 'make-copy',
        label: 'Make a copy',
        keywords: ['duplicate'],
        icon: CopyIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onCopy?.(),
      },
      {
        id: 'share',
        label: 'Share',
        keywords: [],
        icon: Share2Icon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onShare(),
        separatorBefore: true,
      },
      {
        id: 'download',
        label: 'Download',
        keywords: [],
        icon: DownloadIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onDownload?.(),
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
            onSelect: () => window.print(),
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
        onSelect: (context) => context.onDetails?.(),
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
        onSelect: () => window.print(),
      },
    ],
  },
  {
    label: 'Edit',
    items: [
      editOption('undo', 'Undo', Undo2Icon),
      editOption('redo', 'Redo', Redo2Icon),
      editOption('cut', 'Cut', ScissorsIcon, true),
      editOption('copy', 'Copy', CopyIcon),
      editOption('paste', 'Paste', ClipboardPasteIcon),
      editOption('paste-plain', 'Paste without formatting', ClipboardTypeIcon),
      editOption('select-all', 'Select all', TextSelectIcon, true),
      editOption('delete-selection', 'Delete selection', Trash2Icon),
      editOption(
        'clear-formatting',
        'Clear formatting',
        RemoveFormattingIcon,
        true,
      ),
    ],
  },
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

export function useDocumentNavigationOptions() {
  const workspace = useDocumentWorkspace()
  const edit = useEditActions(
    workspace.editorRef,
    workspace.document?.id,
    (message) => toast.error(message),
  )
  const context: NavigationContext = {
    edit,
    enabled: workspace.enabled,
    creating: workspace.creating,
    onOpen: workspace.openDocument,
    onCopy: workspace.copyDocument,
    onShare: workspace.shareDocument,
    onDetails: workspace.showDetails,
    onDownload: workspace.downloadDocument,
    onPageSetup: workspace.openPageSetup,
    onCreate: workspace.createDocument,
    ...useTheme(),
  }
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
      disabled:
        item.disabled?.(context) ||
        (context.enabled === false &&
          !['new-document', 'open'].includes(item.id)),
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
