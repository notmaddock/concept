type GoogleIdentityWindow = Window & {
  google?: { accounts?: { id?: { cancel: () => void } } }
}

export function cancelOneTapPrompt() {
  if (typeof window === 'undefined') return
  const identity = (window as GoogleIdentityWindow).google?.accounts?.id
  identity?.cancel()
}
