Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

# Building For Production

To build this application for production:

```bash
pnpm build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

## Linting & Formatting

This project uses [eslint](https://eslint.org/) and [prettier](https://prettier.io/) for linting and formatting. Eslint is configured using [tanstack/eslint-config](https://tanstack.com/config/latest/docs/eslint). The following scripts are available:

```bash
pnpm lint
pnpm format
pnpm check
```

## Cloudflare and Google Drive

The app runs on Cloudflare Workers. Better Auth stores sessions and encrypted Google tokens in D1; document content stays in IndexedDB and Google Drive. An HttpOnly session cookie authenticates a small token endpoint. The browser keeps the returned access token in memory and calls Drive directly; refresh tokens stay on the server.

Set `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_PROXY_SECRET` in an ignored `.env` file for local development and in Cloudflare secrets for deployed environments. Use independent Better Auth secrets for production and staging. The OAuth proxy secret must match across the trusted environments. Public settings and D1 bindings are in `wrangler.jsonc`.

Register `https://concept.maddock.world/api/auth/callback/google` as the Google OAuth redirect URI. [Better Auth OAuth Proxy](https://better-auth.com/docs/plugins/oauth-proxy) routes local and PR preview callbacks through that production origin. Preview URLs are public and share the `concept-staging` database; production uses `concept`. Only trusted repository PRs deploy previews.

Apply local migrations before starting the dev server:

```bash
pnpm exec wrangler d1 migrations apply DB --local
pnpm run dev
```

CI applies the corresponding remote migrations before deployment. For a manual production deployment:

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm run deploy
```

Generate an additional auth migration after changing the Better Auth schema:

```bash
pnpm exec node scripts/generate-auth-migration.ts migrations/0002_auth.sql
```

Drive uses `drive.file` access. Conditional uploads use Drive v2 ETags and `If-Match`; a 412 response downloads and merges the remote Yjs state before retrying. Save timing is configured in `src/lib/documents/sync.ts` (3 seconds idle, 60 seconds maximum while dirty).

## Setting up PostHog

1. Create a PostHog account at [posthog.com](https://posthog.com)
2. Get your Project API Key from [Project Settings](https://app.posthog.com/project/settings)
3. Set `VITE_POSTHOG_KEY` in your `.env.local`

### Optional Configuration

- `VITE_POSTHOG_HOST` - Set this if you're using PostHog Cloud EU (`https://eu.i.posthog.com`) or self-hosting

## T3Env

- You can use T3Env to add type safety to your environment variables.
- Add Environment variables to the `src/env.mjs` file.
- Use the environment variables in your code.

### Usage

```ts
import { env } from '#/env'

console.log(env.VITE_APP_TITLE)
```

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from '@tanstack/react-router'
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')

  useEffect(() => {
    getServerTime().then(setTime)
  }, [])

  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
