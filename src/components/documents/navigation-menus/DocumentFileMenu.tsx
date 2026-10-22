import {
  CopyIcon,
  DownloadIcon,
  FileDownIcon,
  FileTextIcon,
  FileTypeIcon,
  FolderOpenIcon,
  InfoIcon,
  LetterTextIcon,
  PlusIcon,
  PrinterIcon,
  Settings2Icon,
  Share2Icon,
} from 'lucide-react'
import {
  documentMenuContentClassName,
  documentMenuItemClassName,
  documentMenuTriggerClassName,
  documentSubmenuContentClassName,
} from './menu-styles'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export function DocumentFileMenu({
  onCreate,
  creating,
  disabled,
}: {
  onCreate: () => Promise<void>
  creating: boolean
  disabled: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={documentMenuTriggerClassName}
            disabled={disabled}
          />
        }
      >
        File
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={documentMenuContentClassName}
      >
        <DropdownMenuItem
          className={documentMenuItemClassName}
          onClick={onCreate}
          disabled={creating}
        >
          <PlusIcon /> New document
        </DropdownMenuItem>
        <DropdownMenuItem className={documentMenuItemClassName}>
          <FolderOpenIcon /> Open
        </DropdownMenuItem>
        <DropdownMenuItem className={documentMenuItemClassName}>
          <CopyIcon /> Make a copy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={documentMenuItemClassName}>
          <Share2Icon /> Share
        </DropdownMenuItem>
        <DropdownMenuItem className={documentMenuItemClassName}>
          <DownloadIcon /> Download
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={documentMenuItemClassName}>
            <FileDownIcon /> Export as...
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            side="right"
            align="start"
            alignOffset={-4}
            sideOffset={4}
            className={documentSubmenuContentClassName}
          >
            <DropdownMenuItem className={documentMenuItemClassName}>
              <FileTypeIcon /> PDF (.pdf)
            </DropdownMenuItem>
            <DropdownMenuItem className={documentMenuItemClassName}>
              <FileTextIcon /> Word (.docx)
            </DropdownMenuItem>
            <DropdownMenuItem className={documentMenuItemClassName}>
              <LetterTextIcon /> Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem className={documentMenuItemClassName}>
              <FileTextIcon /> Plain text (.txt)
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={documentMenuItemClassName}>
          <InfoIcon /> Details
        </DropdownMenuItem>
        <DropdownMenuItem className={documentMenuItemClassName}>
          <Settings2Icon /> Page setup
        </DropdownMenuItem>
        <DropdownMenuItem className={documentMenuItemClassName}>
          <PrinterIcon /> Print
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
