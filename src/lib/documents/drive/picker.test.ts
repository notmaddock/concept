import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGooglePickerApiKey,
  getGooglePickerAppId,
  loadGooglePickerApi,
  openGooglePicker,
  resetGooglePickerLoader,
} from './picker'
import { env } from '#/env'

vi.mock('./auth', () => ({
  getGoogleDriveToken: vi.fn(async () => 'mock-auth-token'),
}))

vi.mock('#/env', () => ({
  env: {
    VITE_GOOGLE_CLIENT_ID: '123456789012-abcdef.apps.googleusercontent.com',
    VITE_GOOGLE_PICKER_APP_ID: undefined,
    VITE_GOOGLE_PICKER_API_KEY: undefined,
  },
}))

describe('Google Picker API loading and configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGooglePickerLoader()
    delete (window as { gapi?: unknown }).gapi
    delete (window as { google?: unknown }).google
    document
      .querySelectorAll('script[src*="apis.google.com"]')
      .forEach((s) => s.remove())
  })

  afterEach(() => {
    resetGooglePickerLoader()
    delete (window as { gapi?: unknown }).gapi
    delete (window as { google?: unknown }).google
    document
      .querySelectorAll('script[src*="apis.google.com"]')
      .forEach((s) => s.remove())
  })

  it('infers project number from VITE_GOOGLE_CLIENT_ID as fallback appId', () => {
    expect(getGooglePickerAppId()).toBe('123456789012')
    expect(getGooglePickerAppId('custom-app-id')).toBe('custom-app-id')
  })

  it('prefers explicit VITE_GOOGLE_PICKER_APP_ID when set', () => {
    vi.mocked(env).VITE_GOOGLE_PICKER_APP_ID = '987654321'
    expect(getGooglePickerAppId()).toBe('987654321')
    vi.mocked(env).VITE_GOOGLE_PICKER_APP_ID = undefined
  })

  it('reads VITE_GOOGLE_PICKER_API_KEY or explicit apiKey', () => {
    expect(getGooglePickerApiKey()).toBeUndefined()
    expect(getGooglePickerApiKey('custom-key')).toBe('custom-key')
    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = 'env-api-key'
    expect(getGooglePickerApiKey()).toBe('env-api-key')
    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = undefined
  })

  it('resolves immediately when window.google.picker is already loaded', async () => {
    window.google = { picker: {} as never }
    await expect(loadGooglePickerApi()).resolves.toBeUndefined()
    expect(
      document.querySelector('script[src="https://apis.google.com/js/api.js"]'),
    ).toBeNull()
  })

  it('injects api.js script and initializes picker via gapi.load', async () => {
    const loadPromise = loadGooglePickerApi()
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    )
    expect(script).not.toBeNull()

    // Simulate script load and window.gapi
    const mockPickerNamespace = {
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    }
    window.gapi = {
      load: vi.fn((_api: string, callbacks: unknown) => {
        window.google = { picker: mockPickerNamespace as never }
        if (typeof callbacks === 'function') callbacks()
        else if (
          callbacks &&
          typeof callbacks === 'object' &&
          'callback' in callbacks
        ) {
          ;(callbacks as { callback: () => void }).callback()
        }
      }),
    }

    script?.dispatchEvent(new Event('load'))
    await expect(loadPromise).resolves.toBeUndefined()
    expect(window.gapi.load).toHaveBeenCalledWith('picker', expect.any(Object))
  })

  it('resets and allows retrying if the script tag fails to load', async () => {
    const firstPromise = loadGooglePickerApi()
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    )
    script?.dispatchEvent(new Event('error'))
    await expect(firstPromise).rejects.toThrow(
      'Failed to load Google API script',
    )

    // Subsequent call retries script injection
    const retryPromise = loadGooglePickerApi()
    const newScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    )
    expect(newScript).not.toBeNull()
    window.google = { picker: {} as never }
    window.gapi = {
      load: vi.fn(
        (
          _api: string,
          cb: { callback?: () => void; onerror?: () => void } | (() => void),
        ) => {
          if (typeof cb === 'object' && cb.callback) {
            cb.callback()
          }
        },
      ),
    }
    newScript?.dispatchEvent(new Event('load'))
    await expect(retryPromise).resolves.toBeUndefined()
  })

  it('retries after a synchronous gapi failure', async () => {
    window.gapi = {
      load: vi.fn(() => {
        throw new Error('loader failed')
      }),
    }
    await expect(loadGooglePickerApi()).rejects.toThrow('loader failed')
    window.gapi.load = vi.fn((_api, callbacks) => {
      window.google = { picker: {} as never }
      if (typeof callbacks === 'object') callbacks.callback?.()
    })
    await expect(loadGooglePickerApi()).resolves.toBeUndefined()
  })

  it('removes a timed-out script so another attempt can load it', async () => {
    vi.useFakeTimers()
    try {
      const first = loadGooglePickerApi()
      const failure = expect(first).rejects.toThrow('Timed out')
      await vi.advanceTimersByTimeAsync(15000)
      await failure
      expect(
        document.querySelector(
          'script[src="https://apis.google.com/js/api.js"]',
        ),
      ).toBeNull()
      window.gapi = {
        load: vi.fn((_api, callbacks) => {
          window.google = { picker: {} as never }
          if (typeof callbacks === 'object') callbacks.callback?.()
        }),
      }
      await expect(loadGooglePickerApi()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles gapi.load failure and resets for retry', async () => {
    const loadPromise = loadGooglePickerApi()
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    )
    window.gapi = {
      load: vi.fn(
        (
          _api: string,
          cb: { callback?: () => void; onerror?: () => void } | (() => void),
        ) => {
          if (typeof cb === 'object' && cb.onerror) {
            cb.onerror()
          }
        },
      ),
    }
    script?.dispatchEvent(new Event('load'))
    await expect(loadPromise).rejects.toThrow(
      'Failed to load Google Picker library via gapi.',
    )
  })
})

describe('openGooglePicker workflow', () => {
  let mockBuilder: {
    addView: ReturnType<typeof vi.fn>
    setOAuthToken: ReturnType<typeof vi.fn>
    setDeveloperKey: ReturnType<typeof vi.fn>
    setAppId: ReturnType<typeof vi.fn>
    setTitle: ReturnType<typeof vi.fn>
    enableFeature: ReturnType<typeof vi.fn>
    setCallback: ReturnType<typeof vi.fn>
    build: ReturnType<typeof vi.fn>
  }
  let mockDocsView: {
    setIncludeFolders: ReturnType<typeof vi.fn>
    setFileIds: ReturnType<typeof vi.fn>
    setEnableDrives: ReturnType<typeof vi.fn>
    setMimeTypes: ReturnType<typeof vi.fn>
    setSelectFolderEnabled: ReturnType<typeof vi.fn>
  }
  let mockSharedDrivesView: typeof mockDocsView
  let mockRequestedView: typeof mockDocsView
  let mockPicker: {
    setVisible: ReturnType<typeof vi.fn>
  }
  let callbackRegistered: ((data: Record<string, unknown>) => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    resetGooglePickerLoader()

    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = 'test-api-key'
    mockDocsView = {
      setIncludeFolders: vi.fn().mockReturnThis(),
      setFileIds: vi.fn().mockReturnThis(),
      setEnableDrives: vi.fn().mockReturnThis(),
      setMimeTypes: vi.fn().mockReturnThis(),
      setSelectFolderEnabled: vi.fn().mockReturnThis(),
    }
    mockSharedDrivesView = {
      setIncludeFolders: vi.fn().mockReturnThis(),
      setFileIds: vi.fn().mockReturnThis(),
      setEnableDrives: vi.fn().mockReturnThis(),
      setMimeTypes: vi.fn().mockReturnThis(),
      setSelectFolderEnabled: vi.fn().mockReturnThis(),
    }
    mockRequestedView = {
      setIncludeFolders: vi.fn().mockReturnThis(),
      setFileIds: vi.fn().mockReturnThis(),
      setEnableDrives: vi.fn().mockReturnThis(),
      setMimeTypes: vi.fn().mockReturnThis(),
      setSelectFolderEnabled: vi.fn().mockReturnThis(),
    }
    mockPicker = {
      setVisible: vi.fn(),
    }
    mockBuilder = {
      addView: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setDeveloperKey: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setTitle: vi.fn().mockReturnThis(),
      enableFeature: vi.fn().mockReturnThis(),
      setCallback: vi.fn((cb: (data: Record<string, unknown>) => void) => {
        callbackRegistered = cb
        return mockBuilder
      }),
      build: vi.fn(() => mockPicker),
    }

    window.google = {
      picker: {
        PickerBuilder: vi.fn(function () {
          return mockBuilder
        }) as never,
        DocsView: vi
          .fn()
          .mockImplementationOnce(function () {
            return mockDocsView
          })
          .mockImplementationOnce(function () {
            return mockSharedDrivesView
          })
          .mockImplementationOnce(function () {
            return mockRequestedView
          }) as never,
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: 'action', DOCUMENTS: 'docs' },
        Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType', URL: 'url' },
        ViewId: { DOCS: 'all_docs' },
        Feature: { SUPPORT_DRIVES: 'support_drives' },
      },
    }
  })

  afterEach(() => {
    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = undefined
  })

  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('shows a hinted file first while preserving general browsing as a fallback', async () => {
    const pickPromise = openGooglePicker({ fileId: 'requested-file' })
    await flushPromises()
    expect(mockRequestedView.setFileIds).toHaveBeenCalledWith('requested-file')
    expect(mockRequestedView.setEnableDrives).not.toHaveBeenCalled()
    expect(mockDocsView.setFileIds).not.toHaveBeenCalled()
    expect(mockBuilder.addView).toHaveBeenNthCalledWith(1, mockRequestedView)
    expect(mockBuilder.addView).toHaveBeenNthCalledWith(2, mockDocsView)
    expect(mockBuilder.addView).toHaveBeenNthCalledWith(3, mockSharedDrivesView)
    callbackRegistered?.({ action: 'cancel' })
    expect(await pickPromise).toBeNull()
  })

  it('opens matching files by default and offers shared drives in a separate view', async () => {
    const pickPromise = openGooglePicker()
    await flushPromises()

    expect(mockDocsView.setIncludeFolders).toHaveBeenCalledWith(true)
    expect(mockDocsView.setEnableDrives).not.toHaveBeenCalled()
    expect(mockSharedDrivesView.setEnableDrives).toHaveBeenCalledWith(true)
    const mimeTypes =
      'application/vnd.concept+zip,application/vnd.concept+json,application/zip,application/json,application/octet-stream,text/plain'
    expect(mockDocsView.setMimeTypes).toHaveBeenCalledWith(mimeTypes)
    expect(mockSharedDrivesView.setMimeTypes).toHaveBeenCalledWith(mimeTypes)
    expect(mockBuilder.addView).toHaveBeenNthCalledWith(1, mockDocsView)
    expect(mockBuilder.addView).toHaveBeenNthCalledWith(2, mockSharedDrivesView)
    expect(mockBuilder.setOAuthToken).toHaveBeenCalledWith('mock-auth-token')
    expect(mockBuilder.enableFeature).toHaveBeenCalledWith('support_drives')
    expect(mockBuilder.setAppId).toHaveBeenCalledWith('123456789012')
    expect(mockPicker.setVisible).toHaveBeenCalledWith(true)

    // User selects a file
    callbackRegistered?.({
      action: 'picked',
      docs: [
        {
          id: 'selected-drive-id',
          name: 'Shared Document.concept',
          mimeType: 'application/vnd.concept+json',
        },
      ],
    })

    const result = await pickPromise
    expect(result).toEqual({
      id: 'selected-drive-id',
      name: 'Shared Document.concept',
      mimeType: 'application/vnd.concept+json',
      description: undefined,
      url: undefined,
    })
  })

  it('resolves to null when the user cancels the picker, preserving current state', async () => {
    const pickPromise = openGooglePicker()
    await flushPromises()
    expect(mockPicker.setVisible).toHaveBeenCalledWith(true)

    callbackRegistered?.({ action: 'cancel' })
    const result = await pickPromise
    expect(result).toBeNull()
  })

  it('passes developer key when API key is configured', async () => {
    const pickPromise = openGooglePicker({ apiKey: 'my-picker-api-key' })
    await flushPromises()
    expect(mockBuilder.setDeveloperKey).toHaveBeenCalledWith(
      'my-picker-api-key',
    )
    callbackRegistered?.({ action: 'cancel' })
    await pickPromise
  })

  it('rejects missing configuration before creating a picker', async () => {
    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = undefined
    await expect(openGooglePicker()).rejects.toThrow('API key')
    expect(mockBuilder.build).not.toHaveBeenCalled()
    vi.mocked(env).VITE_GOOGLE_PICKER_API_KEY = 'test-api-key'
    await expect(
      openGooglePicker({ appId: 'not-a-project-number' }),
    ).rejects.toThrow('project number')
  })

  it('disposes the picker after cancellation', async () => {
    const dispose = vi.fn()
    Object.assign(mockPicker, { dispose })
    const result = openGooglePicker()
    await flushPromises()
    callbackRegistered?.({ action: 'cancel' })
    await expect(result).resolves.toBeNull()
    expect(mockPicker.setVisible).toHaveBeenLastCalledWith(false)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    {
      id: '',
      name: 'Missing.concept',
      mimeType: 'application/vnd.concept+json',
    },
    { id: 'pdf', name: 'Other.pdf', mimeType: 'application/pdf' },
    { id: 'unknown', name: 'Unknown' },
  ])('rejects incompatible or malformed selections: $id', async (doc) => {
    const result = openGooglePicker()
    await flushPromises()
    callbackRegistered?.({ action: 'picked', docs: [doc] })
    await expect(result).rejects.toThrow('Select a Concept document')
    expect(mockPicker.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('accepts package MIME types without a filename extension', async () => {
    const result = openGooglePicker()
    await flushPromises()
    callbackRegistered?.({
      action: 'picked',
      docs: [
        { id: 'zip', name: 'Package', mimeType: 'application/vnd.concept+zip' },
      ],
    })
    await expect(result).resolves.toMatchObject({ id: 'zip' })
  })

  it('accepts externally uploaded concept files with generic MIME types', async () => {
    const result = openGooglePicker()
    await flushPromises()
    callbackRegistered?.({
      action: 'picked',
      docs: [
        {
          id: 'uploaded',
          name: 'Shared.CONCEPT',
          mimeType: 'application/octet-stream',
        },
      ],
    })
    await expect(result).resolves.toMatchObject({ id: 'uploaded' })
  })

  it('rejects if picker construction fails', async () => {
    mockBuilder.build.mockImplementationOnce(() => {
      throw new Error('Picker initialization failed')
    })
    await expect(openGooglePicker()).rejects.toThrow(
      'Picker initialization failed',
    )
  })
})
