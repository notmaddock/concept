import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { AccountManager } from './AccountManager'

const {
  client,
  theme,
  sessionState,
  defaultSession,
  passkeyState,
  toastError,
  cancelPrompt,
} = vi.hoisted(() => {
  const session = {
    user: {
      id: 'user-1',
      name: 'Alex Example',
      email: 'alex@example.com',
      image: null,
    },
  }
  const capturedSession: { current: typeof session | null } = {
    current: session,
  }
  const capturedPasskeys: {
    data: Array<{ id: string; name: string | null; aaguid: string }>
  } = { data: [] }
  return {
    passkeyState: capturedPasskeys,
    toastError: vi.fn(),
    cancelPrompt: vi.fn(),
    sessionState: capturedSession,
    defaultSession: session,
    client: {
      useSession: () => ({ data: capturedSession.current, isPending: false }),
      useListPasskeys: () => ({
        data: capturedPasskeys.data,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      }),
      signIn: { social: vi.fn(), passkey: vi.fn() },
      passkey: {
        updatePasskey: vi.fn(),
        addPasskey: vi.fn(),
        deletePasskey: vi.fn(),
      },
      listAccounts: vi.fn(),
      signOut: vi.fn(),
      linkSocial: vi.fn(),
      unlinkAccount: vi.fn(),
      getSession: vi.fn(),
    },
    theme: { theme: 'system', setTheme: vi.fn() },
  }
})
vi.mock('#/lib/auth/google-identity', () => ({
  cancelOneTapPrompt: cancelPrompt,
}))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('#/lib/auth/client', () => ({ authClient: client }))
vi.mock('#/lib/auth/functions', () => ({ disconnectStorage: vi.fn() }))
vi.mock('#/components/theme-provider', () => ({ useTheme: () => theme }))

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.clearAllMocks()
  sessionState.current = defaultSession
  passkeyState.data = []
  client.passkey.updatePasskey.mockResolvedValue({ error: null })
  client.signIn.social.mockResolvedValue({ error: null })
  client.signIn.passkey.mockResolvedValue({ error: null })
  client.listAccounts.mockResolvedValue({
    data: [
      {
        id: 'google-account',
        accountId: 'google-subject',
        providerId: 'google',
        scopes: ['openid', 'email', 'profile'],
      },
    ],
  })
  client.signOut.mockResolvedValue({ error: null })
  client.linkSocial.mockResolvedValue({ error: null })
  client.getSession.mockImplementation(async () => ({
    data: sessionState.current,
    error: null,
  }))
  client.passkey.addPasskey.mockResolvedValue({ error: null })
  client.passkey.deletePasskey.mockResolvedValue({ error: null })
  client.unlinkAccount.mockResolvedValue({ error: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(() => root.render(<AccountManager />))
})
afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function click(selector: string, text?: string) {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  ).find((element) => text === undefined || element.textContent.trim() === text)
  expect(target).toBeDefined()
  await act(() => target!.click())
}
async function menu() {
  await click('[aria-label="Account menu"]')
}

it('shows identity in the menu and separates sign-in from storage settings', async () => {
  await menu()
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    'Alex Example',
  )
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    'alex@example.com',
  )
  await click('[role="menuitem"]', 'Account settings')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Passkeys',
  )
  expect(document.querySelector('button[disabled]')?.textContent).toBe('Unlink')
  const sidebarHeader = document.querySelector(
    '[data-slot="sidebar"] [data-slot="sidebar-header"]',
  )
  expect(sidebarHeader?.textContent).toContain('Alex Example')
  expect(sidebarHeader?.textContent).toContain('alex@example.com')
  await click('button', 'Connections')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Google Drive',
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Not connected',
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    'Passkeys',
  )
  expect(
    document.querySelector('[aria-label="Storage connections"]')?.textContent,
  ).toBe('ConnectionsGoogle DriveNot connectedConnect')
  await click('button', 'Connect')
  expect(client.linkSocial).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'google',
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.install',
      ],
    }),
  )
})

it('requires confirmation before logging out and allows cancellation', async () => {
  await menu()
  await click('[role="menuitem"]', 'Log out')
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    'Log out of Concept?',
  )
  expect(client.signOut).not.toHaveBeenCalled()
  await click('button', 'Cancel')
  expect(client.signOut).not.toHaveBeenCalled()
  await menu()
  await click('[role="menuitem"]', 'Log out')
  await click('button', 'Log out')
  expect(client.signOut).toHaveBeenCalledOnce()
})

it('offers all three themes and applies the selected value', async () => {
  await menu()
  const trigger = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((element) => element.textContent.includes('Theme'))
  expect(trigger).toBeDefined()
  await act(() => trigger!.click())
  const choices = Array.from(
    document.querySelectorAll('[role="menuitemradio"]'),
  ).map((item) => item.textContent)
  expect(choices).toEqual(['Light', 'Dark', 'System'])
  await click('[role="menuitemradio"]', 'Light')
  expect(theme.setTheme).toHaveBeenCalledWith('light')
})

it('keeps login actions in the signed-out profile menu and hides settings', async () => {
  sessionState.current = null
  await act(() => root.render(<AccountManager />))
  await menu()
  const content = document.querySelector('[role="menu"]')?.textContent
  expect(content).toContain('Sign in with Google')
  expect(content).toContain('Sign in with passkey')
  expect(content).not.toContain('Account settings')
  expect(content).not.toContain('Log out')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('[role="menuitem"]', 'Sign in with Google')
  expect(client.signIn.social).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'google' }),
  )
  await click('[role="menuitem"]', 'Sign in with passkey')
  expect(cancelPrompt).toHaveBeenCalledTimes(2)
  expect(client.signIn.passkey).toHaveBeenCalledOnce()
})

it('reports cancelled authentication with a toast instead of inline menu text', async () => {
  sessionState.current = null
  client.signIn.passkey.mockResolvedValueOnce({
    error: { message: 'Authentication cancelled' },
  })
  await act(() => root.render(<AccountManager />))
  await menu()
  await click('[role="menuitem"]', 'Sign in with passkey')
  expect(toastError).toHaveBeenCalledWith('Authentication cancelled')
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
    'Authentication cancelled',
  )
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it('defaults unnamed passkeys to their authenticator and saves a custom name', async () => {
  passkeyState.data = [
    { id: 'key-1', name: null, aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4' },
  ]
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  expect(
    document.querySelector('[aria-label="Passkeys"]')?.textContent,
  ).toContain('Google Password Manager')
  await click('[aria-label="Rename Google Password Manager"]')
  const input = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input',
  )!
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, ' Work laptop ')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('button', 'Save')
  expect(client.passkey.updatePasskey).toHaveBeenCalledWith({
    id: 'key-1',
    name: 'Work laptop',
  })
})

it('keeps previously granted Drive scopes disconnected after authentication-only relinking', async () => {
  client.listAccounts.mockResolvedValueOnce({
    data: [
      {
        id: 'google-account',
        accountId: 'subject',
        providerId: 'google',
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.install',
        ],
        driveConnected: false,
      },
    ],
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Connections')
  expect(
    document.querySelector('[aria-label="Storage connections"]')?.textContent,
  ).toBe('ConnectionsGoogle DriveNot connectedConnect')
})

it('offers Connect to upgrade an existing Drive connection without installation permission', async () => {
  client.listAccounts.mockResolvedValueOnce({
    data: [
      {
        id: 'google-account',
        accountId: 'subject',
        providerId: 'google',
        driveConnected: true,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    ],
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Connections')
  expect(
    document.querySelector('[aria-label="Storage connections"]')?.textContent,
  ).toBe('ConnectionsGoogle DriveNot connectedConnect')
  await click('button', 'Connect')
  expect(client.linkSocial).toHaveBeenCalledWith(
    expect.objectContaining({
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.install',
      ],
      additionalParams: { prompt: 'consent' },
    }),
  )
})

it('keeps reconnect in Drive options and offers no private data permission', async () => {
  client.listAccounts.mockResolvedValueOnce({
    data: [
      {
        id: 'google-account',
        accountId: 'subject',
        providerId: 'google',
        driveConnected: true,
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.install',
        ],
      },
    ],
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Connections')
  expect(
    document.querySelector('[aria-label="Storage connections"]')?.textContent,
  ).toBe('ConnectionsGoogle DriveConnected')
  await click('[aria-label="Google Drive options"]')
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    'Reconnect',
  )
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
    'private',
  )
  await click('[role="menuitem"]', 'Reconnect')
  expect(client.linkSocial).toHaveBeenCalledWith(
    expect.objectContaining({
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.install',
      ],
    }),
  )
})

it.each(['google', 'passkey'] as const)(
  'shows a spinner while %s sign-in is pending and restores it after failure',
  async (method) => {
    sessionState.current = null
    let finish: (result: { error: { message: string } }) => void = () => {}
    const pending = new Promise<{ error: { message: string } }>((resolve) => {
      finish = resolve
    })
    if (method === 'google') client.signIn.social.mockReturnValueOnce(pending)
    else client.signIn.passkey.mockReturnValueOnce(pending)
    await act(() => root.render(<AccountManager />))
    await menu()
    const label =
      method === 'google' ? 'Sign in with Google' : 'Sign in with passkey'
    await click('[role="menuitem"]', label)
    const active = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((element) => element.textContent.trim() === label)!
    expect(active.getAttribute('aria-busy')).toBe('true')
    expect(active.querySelector('.animate-spin')).not.toBeNull()
    expect(active.getAttribute('aria-disabled')).toBe('true')
    const loginOptions = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).filter((element) => element.textContent.includes('Sign in with'))
    expect(
      loginOptions.every(
        (element) => element.getAttribute('aria-disabled') === 'true',
      ),
    ).toBe(true)
    await act(() => finish({ error: { message: 'Cancelled' } }))
    expect(active.querySelector('.animate-spin')).toBeNull()
    expect(active.getAttribute('aria-busy')).toBe('false')
  },
)

it.each(['rejected', 'returned'] as const)(
  'clears a %s account-load error after retrying successfully',
  async (failure) => {
    if (failure === 'rejected')
      client.listAccounts.mockRejectedValueOnce(new Error('Offline'))
    else
      client.listAccounts.mockResolvedValueOnce({
        error: { message: 'Could not load connections.' },
      })
    await menu()
    await click('[role="menuitem"]', 'Account settings')
    await click('button', 'Connections')
    expect(
      document.querySelector('[aria-label="Storage connections"]')?.textContent,
    ).toContain('Retry connections')
    client.listAccounts.mockResolvedValueOnce({
      data: [
        {
          id: 'google-account',
          accountId: 'subject',
          providerId: 'google',
          driveConnected: true,
          scopes: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.install',
          ],
        },
      ],
    })
    await click('button', 'Retry connections')
    expect(client.listAccounts).toHaveBeenCalledTimes(2)
    expect(
      document.querySelector('[aria-label="Storage connections"]')?.textContent,
    ).toBe('ConnectionsGoogle DriveConnected')
  },
)

it('does not offer to retry loaded connections after a connection action fails', async () => {
  client.linkSocial.mockResolvedValueOnce({
    error: { message: 'Connection cancelled' },
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Connections')
  await click('button', 'Connect')
  expect(toastError).toHaveBeenCalledWith('Connection cancelled')
  expect(
    document.querySelector('[aria-label="Storage connections"]')?.textContent,
  ).not.toContain('Retry connections')
})

it('opens reauthentication dialog on stale session during passkey registration and allows recovery', async () => {
  client.passkey.addPasskey
    .mockResolvedValueOnce({
      error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
    })
    .mockResolvedValueOnce({ error: null })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Add')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(document.body.textContent).toContain('Confirm your identity')

  await click('button', 'Confirm with passkey')
  expect(client.signIn.passkey).toHaveBeenCalled()
  expect(client.passkey.addPasskey).toHaveBeenCalledTimes(2)
})

it('cancels reauthentication on stale session when user dismisses reauth prompt', async () => {
  client.passkey.addPasskey.mockResolvedValueOnce({
    error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Add')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(document.body.textContent).toContain('Confirm your identity')

  await click('button', 'Cancel')
  expect(toastError).toHaveBeenCalledWith('Authentication cancelled')
  expect(client.passkey.addPasskey).toHaveBeenCalledTimes(1)
})

it('rejects retrying sensitive action if reauthenticated under a different user', async () => {
  client.passkey.addPasskey.mockResolvedValueOnce({
    error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
  })
  client.getSession.mockResolvedValueOnce({
    data: { user: { id: 'different-user-id' } },
    error: null,
  })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Add')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(document.body.textContent).toContain('Confirm your identity')

  await click('button', 'Confirm with passkey')
  expect(toastError).toHaveBeenCalledWith(
    'Reauthenticated with a different account.',
  )
  expect(client.passkey.addPasskey).toHaveBeenCalledTimes(1)
})

it('opens reauthentication dialog on stale session during Google unlinking and allows recovery', async () => {
  passkeyState.data = [
    {
      id: 'key-1',
      name: 'Key',
      aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',
    },
  ]
  client.unlinkAccount
    .mockResolvedValueOnce({
      error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
    })
    .mockResolvedValueOnce({ error: null })
  await menu()
  await click('[role="menuitem"]', 'Account settings')
  await click('button', 'Unlink')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(document.body.textContent).toContain('Confirm your identity')

  await click('button', 'Confirm with passkey')
  expect(client.signIn.passkey).toHaveBeenCalled()
  expect(client.unlinkAccount).toHaveBeenCalledTimes(2)
})
