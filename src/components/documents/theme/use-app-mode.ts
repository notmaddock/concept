import { useEffect, useState } from 'react'
import { useTheme } from '#/components/theme-provider'

export type ResolvedAppMode = 'light' | 'dark'

export function useResolvedAppMode(): ResolvedAppMode {
  const { theme } = useTheme()
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    if (theme !== 'system') return
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}
