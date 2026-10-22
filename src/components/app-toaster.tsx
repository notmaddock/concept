import { useTheme } from './theme-provider'
import { Toaster } from './ui/sonner'

export function AppToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} />
}
