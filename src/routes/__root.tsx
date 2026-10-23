import { OneTapPrompt } from '#/components/account/OneTapPrompt'
import { AppToaster } from '#/components/app-toaster'
import {
  ErrorComponent,
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { ThemeProvider } from '#/components/theme-provider'
import { NotFound } from '#/components/not-found'
import { TooltipProvider } from '#/components/ui/tooltip'

import PostHogProvider from '../integrations/posthog/provider'

import appCss from '../styles.css?url'

const description =
  'Concept is a local-first rich-text document editor with optional Google Drive sync.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      ...(import.meta.env.DEV
        ? [{ name: 'referrer', content: 'no-referrer-when-downgrade' }]
        : []),
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Concept',
      },
      { name: 'description', content: description },
      { name: 'application-name', content: 'Concept' },
      { name: 'creator', content: 'Concept' },
      { property: 'og:title', content: 'Concept' },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Concept' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Concept' },
      { name: 'twitter:description', content: description },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/icon.svg',
        type: 'image/svg+xml',
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
        sizes: 'any',
      },
    ],
  }),
  errorComponent: ErrorComponent,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="theme">
          <PostHogProvider>
            <TooltipProvider delay={200}>
              {children}
              <AppToaster />
              <OneTapPrompt />
              <TanStackDevtools
                config={{
                  position: 'bottom-right',
                }}
                plugins={[
                  {
                    name: 'Tanstack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                ]}
              />
            </TooltipProvider>
          </PostHogProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
