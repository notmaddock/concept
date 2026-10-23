import type { ComponentProps } from 'react'

export function GoogleDriveIcon({
  className = 'size-4',
  ...props
}: Omit<ComponentProps<'img'>, 'src' | 'alt'>) {
  return (
    <img
      {...props}
      src="/icons/google-drive.svg"
      alt=""
      aria-hidden="true"
      className={className}
    />
  )
}
