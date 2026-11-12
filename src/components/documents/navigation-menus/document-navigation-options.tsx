import { INSERT_IMAGE_COMMAND } from '#/components/nova/images/commands'
import { OPEN_LINK_DIALOG_COMMAND } from '#/components/nova/plugins/LinkPlugin/commands'
import { INSERT_PAGE_BREAK } from '#/components/nova/pages/PageBreakExtension'
import { exportFormats, importFormats } from '#/lib/documents/formats'
import type { ImportFormat } from '#/lib/documents/formats'
import type { ExportFormat } from '#/lib/documents/export'
import {
  DEFAULT_DOCUMENT_THEME_ID,
  documentThemes,
} from '#/lib/documents/document-themes'
import {
  getDocumentTheme,
  subscribeDocumentTheme,
} from '#/lib/documents/document-theme'
import { selectDocumentTheme } from '../theme/select-document-theme'
import { useCallback, useSyncExternalStore } from 'react'
import { formatActions, formatSections } from './format-options'
import type { useFormatActions } from './use-format-actions'

import type { EditAction, useEditActions } from './use-edit-actions'
import { useDocumentWorkspace } from '../document-workspace-context'
import { DriveIcon } from '../icons/DriveIcon'
import {
  CopyIcon,
  ImageIcon,
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
  LinkIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  PrinterIcon,
  Settings2Icon,
  Share2Icon,
  SparklesIcon,
  SunIcon,
} from 'lucide-react'
import { useTheme } from '#/components/theme-provider'

export { formatActions }

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
  format: ReturnType<typeof useFormatActions>
  edit: ReturnType<typeof useEditActions>
  enabled?: boolean
  readOnly?: boolean
  drivePickerDisabled?: boolean
  onOpenDrive?: () => Promise<void>
  onImport?: (format: ImportFormat) => void
  onOpen?: () => void
  onDetails?: () => void
  onShowChangelog: () => void
  onShare: () => void
  onCopy?: () => void
  onDownload?: () => void | Promise<void>
  onSaveToDrive?: () => void | Promise<void>
  onExport: (format: ExportFormat) => Promise<void>
  onInsertImage?: () => void
  onInsertLink?: () => void
  onInsertPageBreak: () => void
  onPageSetup: () => void
  onCreate: () => Promise<void>
  creating: boolean
  theme: ReturnType<typeof useTheme>['theme']
  setTheme: ReturnType<typeof useTheme>['setTheme']
  documentTheme: string
  setDocumentTheme: (id: string) => void
}

type ActionDefinition = {
  id: string
  label: string
  shortcut?: ActionShortcut
  menuLabel?: string
  keywords: string[]
  icon: typeof PlusIcon | typeof DriveIcon
  focusAfterSelect: 'editor' | 'action'
  onSelect: (context: NavigationContext) => void | Promise<void>
  disabled?: (context: NavigationContext) => boolean
  toggle?: boolean
  checked?: (context: NavigationContext) => boolean | undefined
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
        id: 'import',
        label: 'Import from…',
        icon: FolderOpenIcon,
        children: importFormats.map((format) => ({
          id: `import-${format.id}`,
          label: `Import from ${format.label}`,
          menuLabel: format.label,
          keywords: format.extensions,
          icon: FileTextIcon,
          focusAfterSelect: 'action' as const,
          onSelect: (context: NavigationContext) =>
            context.onImport?.(format.id),
        })),
      },
      {
        id: 'save-to-drive',
        label: 'Save to Google Drive',
        keywords: ['save', 'drive', 'cloud'],
        icon: DriveIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onSaveToDrive?.(),
        disabled: (context) => Boolean(context.readOnly),
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
        children: (
          [
            {
              id: 'export-pdf',
              label: 'Export as PDF',
              menuLabel: 'PDF (.pdf)',
              keywords: ['download'],
              icon: FileTypeIcon,
              onSelect: () => window.print(),
            },
            {
              id: 'export-word',
              label: 'Export as Word',
              menuLabel: 'Word (.docx)',
              keywords: ['docx'],
              icon: FileTextIcon,
              onSelect: () => {},
              disabled: () => true,
            },
            ...exportFormats.map((format) => ({
              id: `export-${format.id}`,
              label:
                format.id === 'text'
                  ? 'Export as plain text'
                  : `Export as ${format.label}`,
              menuLabel: `${format.label} (.${format.extension})`,
              keywords: format.extensions,
              icon:
                format.id === 'markdown'
                  ? LetterTextIcon
                  : format.id === 'html'
                    ? FileTypeIcon
                    : FileTextIcon,
              onSelect: (context: NavigationContext) =>
                context.onExport(format.id),
            })),
          ] satisfies Omit<ActionDefinition, 'focusAfterSelect'>[]
        ).map((item) => ({ ...item, focusAfterSelect: 'action' as const })),
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
        disabled: (context) => Boolean(context.readOnly),
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
    items: (
      [
        ['undo', 'Undo', Undo2Icon],
        ['redo', 'Redo', Redo2Icon],
        ['cut', 'Cut', ScissorsIcon, true],
        ['copy', 'Copy', CopyIcon],
        ['paste', 'Paste', ClipboardPasteIcon],
        ['paste-plain', 'Paste without formatting', ClipboardTypeIcon],
        ['select-all', 'Select all', TextSelectIcon, true],
        ['delete-selection', 'Delete selection', Trash2Icon],
        ['clear-formatting', 'Clear formatting', RemoveFormattingIcon, true],
      ] as const
    ).map(([id, label, icon, sep]) => editOption(id, label, icon, sep)),
  },
  {
    label: 'View',
    items: [
      {
        id: 'theme',
        label: 'Appearance',
        icon: PaletteIcon,
        children: (
          [
            ['light', 'Light theme', 'Light', SunIcon, ['appearance']],
            ['dark', 'Dark theme', 'Dark', MoonIcon, ['appearance']],
            [
              'system',
              'System theme',
              'System',
              MonitorIcon,
              ['appearance', 'automatic'],
            ],
          ] as const
        ).map(([id, label, menuLabel, icon, keywords]) => ({
          id: `theme-${id}`,
          label,
          menuLabel,
          keywords: [...keywords],
          icon,
          focusAfterSelect: 'editor' as const,
          onSelect: (context: NavigationContext) => context.setTheme(id),
          checked: (context: NavigationContext) => context.theme === id,
        })),
      },
      {
        id: 'document-theme',
        label: 'Document theme',
        icon: PaletteIcon,
        children: documentThemes.map((theme) => ({
          id: `document-theme-${theme.id}`,
          label: `${theme.label} theme`,
          menuLabel: theme.label,
          keywords: [
            'theme',
            'color',
            'background',
            theme.label.toLowerCase(),
            theme.id,
          ],
          icon: PaletteIcon,
          focusAfterSelect: 'editor' as const,
          onSelect: (context: NavigationContext) =>
            context.setDocumentTheme(theme.id),
          checked: (context: NavigationContext) =>
            context.documentTheme === theme.id,
          disabled: (context: NavigationContext) => Boolean(context.readOnly),
        })),
      },
    ],
  },
  {
    label: 'Insert',
    items: [
      {
        id: 'insert-image',
        label: 'Image',
        keywords: ['picture', 'photo'],
        icon: ImageIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onInsertImage?.(),
        disabled: (context) => Boolean(context.readOnly),
      },
      {
        id: 'insert-link',
        label: 'Link',
        keywords: ['url', 'hyperlink'],
        icon: LinkIcon,
        shortcut: { keys: ['Ctrl', 'K'], macKeys: ['⌘', 'K'] },
        focusAfterSelect: 'action',
        onSelect: (context) => context.onInsertLink?.(),
        disabled: (context) => Boolean(context.readOnly),
      },
      {
        id: 'insert-page-break',
        label: 'Page break',
        keywords: ['page', 'break', 'pagination'],
        icon: ScissorsIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onInsertPageBreak(),
        disabled: (context) => Boolean(context.readOnly),
      },
    ],
  },
  {
    label: 'Format',
    items: formatSections.map((section) => ({
      id: `format-${section.id}`,
      label: section.label,
      icon: section.icon,
      children: section.choices.map((choice) => ({
        id: choice.id,
        shortcut: choice.shortcut,
        label: choice.label,
        icon: section.icon,
        toggle: true,
        keywords: ['format', section.label],
        focusAfterSelect: 'editor' as const,
        onSelect: (context: NavigationContext) =>
          context.format.run(choice.action),
        disabled: (context: NavigationContext) => context.format.disabled,
        checked: (context: NavigationContext) =>
          context.format.checked(choice.action),
      })),
    })),
  },
  { label: 'Tools', items: [] },
  {
    label: 'Help',
    items: [
      {
        id: 'whats-new',
        label: "What's new",
        keywords: ['changelog', 'release notes', 'updates', 'version'],
        icon: SparklesIcon,
        focusAfterSelect: 'action',
        onSelect: (context) => context.onShowChangelog(),
      },
    ],
  },
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
      disabled: boolean
      children: NavigationMenuItem[]
    })

export type NavigationActions = Pick<NavigationContext, 'edit' | 'format'>

const disabledActions: NavigationActions = {
  edit: { run: async () => {}, disabled: () => true },
  format: { run: async () => {}, disabled: true, checked: () => undefined },
}

export function useDocumentNavigationOptions({
  edit,
  format,
}: NavigationActions = disabledActions) {
  const workspace = useDocumentWorkspace()
  const readOnly = Boolean(
    workspace.document?.readOnly || workspace.document?.drive?.readOnly,
  )
  const documentId = workspace.document?.id ?? ''
  const documentTheme = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeDocumentTheme(documentId, listener),
      [documentId],
    ),
    () => getDocumentTheme(documentId),
    () => DEFAULT_DOCUMENT_THEME_ID,
  )
  const context: NavigationContext = {
    edit,
    format,
    enabled: workspace.enabled,
    readOnly,
    creating: workspace.creating,
    onOpen: workspace.openDocument,
    onOpenDrive: workspace.openGoogleDrivePicker,
    drivePickerDisabled:
      !workspace.driveConnected ||
      workspace.driveLoading ||
      workspace.pickerLoading,
    onImport: workspace.importDocument,
    onCopy: workspace.copyDocument,
    onShare: workspace.shareDocument,
    onDetails: workspace.showDetails,
    onShowChangelog: workspace.showChangelog,
    onDownload: workspace.downloadDocument,
    onSaveToDrive: workspace.saveToDrive,
    onExport: workspace.exportDocument,
    onPageSetup: workspace.openPageSetup,
    onInsertImage: () => {
      workspace.editorRef.current?.dispatchCommand(
        INSERT_IMAGE_COMMAND,
        undefined,
      )
    },
    onInsertLink: () => {
      workspace.editorRef.current?.dispatchCommand(
        OPEN_LINK_DIALOG_COMMAND,
        undefined,
      )
    },
    onInsertPageBreak: () => {
      workspace.editorRef.current?.dispatchCommand(INSERT_PAGE_BREAK, undefined)
    },
    onCreate: workspace.createDocument,
    documentTheme,
    setDocumentTheme: (id) =>
      selectDocumentTheme(workspace.editorRef.current, id, readOnly),
    ...useTheme(),
  }
  const options: NavigationOption[] = []

  function bindItem(
    item: MenuItemDefinition,
    group: string,
  ): NavigationMenuItem {
    if ('children' in item) {
      const children = item.children.map((child) => bindItem(child, group))
      return {
        ...item,
        children,
        disabled: children.every((child) => child.disabled),
      }
    }

    const option: NavigationOption = {
      ...item,
      group,
      onSelect: () => item.onSelect(context),
      disabled:
        item.disabled?.(context) ||
        (context.enabled === false &&
          !['new-document', 'open', 'open-drive', 'whats-new'].includes(
            item.id,
          ) &&
          !item.id.startsWith('import-')),
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

const actionShortcuts = new Map<string, ActionShortcut>()
function indexShortcuts(items: MenuItemDefinition[]) {
  for (const item of items) {
    if ('children' in item) indexShortcuts(item.children)
    else if (item.shortcut) actionShortcuts.set(item.id, item.shortcut)
  }
}
indexShortcuts(documentNavigation.flatMap((menu) => menu.items))

export function getDocumentActionShortcut(
  id: string,
): ActionShortcut | undefined {
  return actionShortcuts.get(id)
}
