import { useMediaQuery } from './use-media-query'

const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY)
}
