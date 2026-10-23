import { HardDriveIcon, MonitorIcon } from 'lucide-react'
import { GoogleDriveIcon } from '#/components/icons/GoogleDriveIcon'

export const storageLocations = {
  drive: {
    id: 'drive',
    label: 'Google Drive',
    description: 'Concept files in your connected Google Drive account',
    icon: GoogleDriveIcon,
  },
  local: {
    id: 'local',
    label: 'This browser',
    description: 'Documents saved in this browser’s library',
    icon: MonitorIcon,
  },
  device: {
    id: 'device',
    label: 'This device',
    description: 'Choose a .concept file',
    icon: HardDriveIcon,
  },
}
