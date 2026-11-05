import { env } from '#/env'
import { getGoogleDriveToken } from './auth'

export interface GooglePickerDocument {
  id: string
  name: string
  mimeType: string
  description?: string
  url?: string
}

export interface GooglePickerOptions {
  appId?: string
  apiKey?: string
  token?: string
  title?: string
  fileId?: string
}

export interface GooglePickerBuilder {
  addView: (view: unknown) => this
  setOAuthToken: (token: string) => this
  setDeveloperKey: (key: string) => this
  setAppId: (appId: string) => this
  setTitle: (title: string) => this
  enableFeature: (feature: string) => this
  setCallback: (callback: (data: GooglePickerCallbackData) => void) => this
  build: () => GooglePickerInstance
}

export interface GooglePickerInstance {
  setVisible: (visible: boolean) => void
  dispose?: () => void
}

export interface GoogleDocsView {
  setIncludeFolders: (include: boolean) => this
  setFileIds: (fileIds: string) => this
  setEnableDrives: (enable: boolean) => this
  setMimeTypes: (mimeTypes: string) => this
  setSelectFolderEnabled: (enabled: boolean) => this
}

export interface GooglePickerCallbackData {
  action?: string
  [key: string]: unknown
  docs?: Array<{
    id?: string
    name?: string
    mimeType?: string
    description?: string
    url?: string
    [key: string]: unknown
  }>
}

export interface GooglePickerNamespace {
  PickerBuilder: new () => GooglePickerBuilder
  DocsView: new (viewId?: string) => GoogleDocsView
  Action: {
    PICKED: string
    CANCEL: string
    LOADED?: string
  }
  Response: {
    ACTION: string
    DOCUMENTS: string
  }
  Document: {
    ID: string
    NAME: string
    MIME_TYPE: string
    URL: string
  }
  ViewId: {
    DOCS: string
    FOLDERS?: string
  }
  Feature: {
    SUPPORT_DRIVES: string
    NAV_HIDDEN?: string
    MULTISELECT_ENABLED?: string
  }
}

declare global {
  interface Window {
    gapi?: {
      load: (
        api: string,
        callbacks:
          { callback?: () => void; onerror?: () => void } | (() => void),
      ) => void
    }
    google?: {
      picker?: GooglePickerNamespace
    }
  }
}

let loaderPromise: Promise<void> | null = null

export function resetGooglePickerLoader(): void {
  loaderPromise = null
}

export function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Google Picker is only available in browser environments.'),
    )
  }
  if (window.google?.picker) {
    return Promise.resolve()
  }
  if (loaderPromise) {
    return loaderPromise
  }

  loaderPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    )
    const script = existingScript ?? document.createElement('script')
    function cleanup(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      script.removeEventListener('load', onGapiReady)
      script.removeEventListener('error', onScriptError)
      if (error && !window.gapi) script.remove()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      cleanup(new Error('Timed out waiting for Google Picker API to load.'))
    }, 15000)

    function onGapiReady() {
      if (settled) return
      if (!window.gapi?.load) {
        cleanup(new Error('Google API loader (gapi) is not available.'))
        return
      }
      try {
        window.gapi.load('picker', {
          callback: () => {
            if (window.google?.picker) {
              cleanup()
            } else {
              cleanup(
                new Error('Google Picker namespace not found after loading.'),
              )
            }
          },
          onerror: () => {
            cleanup(new Error('Failed to load Google Picker library via gapi.'))
          },
        })
      } catch (err) {
        cleanup(
          err instanceof Error
            ? err
            : new Error('Failed to execute gapi.load for Google Picker.'),
        )
      }
    }

    if (window.gapi) {
      onGapiReady()
      return
    }

    function onScriptError() {
      cleanup(new Error('Failed to load Google API script.'))
    }

    script.addEventListener('load', onGapiReady, { once: true })
    script.addEventListener('error', onScriptError, { once: true })
    if (existingScript) return
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.defer = true
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    loaderPromise = null
    throw error
  })

  return loaderPromise
}

export function getGooglePickerAppId(customAppId?: string): string | undefined {
  const custom = customAppId?.trim()
  if (custom) return custom
  const envAppId = env.VITE_GOOGLE_PICKER_APP_ID?.trim()
  if (envAppId) return envAppId
  const clientId = env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (clientId && /^\d+/.test(clientId)) {
    return clientId.split('-')[0].trim()
  }
  return undefined
}

export function getGooglePickerApiKey(
  customApiKey?: string,
): string | undefined {
  return (
    customApiKey?.trim() || env.VITE_GOOGLE_PICKER_API_KEY?.trim() || undefined
  )
}

export async function openGooglePicker(
  options: GooglePickerOptions = {},
): Promise<GooglePickerDocument | null> {
  const appId = getGooglePickerAppId(options.appId)
  const apiKey = getGooglePickerApiKey(options.apiKey)
  if (!appId || !/^\d+$/.test(appId)) {
    throw new Error('Configure a valid Google Picker Cloud project number.')
  }
  if (!apiKey) {
    throw new Error('Configure the Google Picker API key to open Drive files.')
  }
  await loadGooglePickerApi()
  const token = options.token || (await getGoogleDriveToken())

  const pickerNamespace = window.google?.picker
  if (!pickerNamespace) {
    throw new Error('Google Picker API is unavailable.')
  }

  return new Promise<GooglePickerDocument | null>((resolve, reject) => {
    let picker: GooglePickerInstance | undefined
    let settled = false
    const finish = (document: GooglePickerDocument | null) => {
      if (settled) return
      settled = true
      picker?.setVisible(false)
      picker?.dispose?.()
      resolve(document)
    }
    try {
      const mimeTypes =
        'application/vnd.concept+json,application/json,application/octet-stream,text/plain'
      const docsView = new pickerNamespace.DocsView(pickerNamespace.ViewId.DOCS)
        .setIncludeFolders(true)
        .setMimeTypes(mimeTypes)
      const sharedDrivesView = new pickerNamespace.DocsView(
        pickerNamespace.ViewId.DOCS,
      )
        .setIncludeFolders(true)
        .setEnableDrives(true)
        .setMimeTypes(mimeTypes)

      const builder = new pickerNamespace.PickerBuilder()
        .setOAuthToken(token)
        .enableFeature(pickerNamespace.Feature.SUPPORT_DRIVES)

      if (options.fileId) {
        builder.addView(
          new pickerNamespace.DocsView(pickerNamespace.ViewId.DOCS)
            .setFileIds(options.fileId)
            .setMimeTypes(mimeTypes),
        )
      }
      builder.addView(docsView).addView(sharedDrivesView)

      if (appId) {
        builder.setAppId(appId)
      }
      if (apiKey) {
        builder.setDeveloperKey(apiKey)
      }
      if (options.title) {
        builder.setTitle(options.title)
      }

      builder.setCallback((data: GooglePickerCallbackData) => {
        if (settled) return
        const action =
          (data[pickerNamespace.Response.ACTION] as string) || data.action
        if (action === pickerNamespace.Action.PICKED) {
          const docs =
            (data[pickerNamespace.Response.DOCUMENTS] as
              GooglePickerCallbackData['docs'] | undefined) ||
            data.docs ||
            []
          if (docs.length === 0) {
            finish(null)
            return
          }
          const doc = docs[0]
          const docId =
            (doc[pickerNamespace.Document.ID] as string) || doc.id || ''
          const docName =
            (doc[pickerNamespace.Document.NAME] as string) ||
            doc.name ||
            'Untitled'
          const docMime =
            (doc[pickerNamespace.Document.MIME_TYPE] as string) ||
            doc.mimeType ||
            ''
          if (
            !docId.trim() ||
            (docMime !== 'application/vnd.concept+json' &&
              !docName.toLowerCase().endsWith('.concept'))
          ) {
            settled = true
            picker?.setVisible(false)
            picker?.dispose?.()
            reject(new Error('Select a Concept document (.concept).'))
            return
          }
          const docUrl =
            (doc[pickerNamespace.Document.URL] as string) || doc.url
          finish({
            id: docId,
            name: docName,
            mimeType: docMime,
            description: doc.description,
            url: docUrl,
          })
        } else if (action === pickerNamespace.Action.CANCEL) {
          finish(null)
        }
      })

      picker = builder.build()
      picker.setVisible(true)
    } catch (cause) {
      reject(
        cause instanceof Error
          ? cause
          : new Error('Failed to open Google Drive file picker.'),
      )
    }
  })
}
