import { HardDriveIcon, MonitorIcon } from 'lucide-react'

export const storageLocations = {
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
