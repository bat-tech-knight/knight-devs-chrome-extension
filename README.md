# Knight Devs Autofill Extension

Chrome extension for filling Greenhouse and Lever applications using selected expert profiles from `knight-devs-platform`.

## Features

- Profile picker for users with multiple expert profiles
- Per-site trigger mode:
  - `manual` (in-page autofill button + popup Fill now)
  - `auto_on_load`
- Per-site submit mode:
  - `fill_only`
  - `fill_and_submit`
- Pluggable site adapter architecture for adding more job sites later

## Project Structure

- `src/background.ts`: popup/content coordination and state updates
- `src/content/*`: site adapters, fill engine, and in-page button
- `src/lib/*`: API client, schema normalizer, storage helpers
- `src/popup/*`: popup UI and profile selector

## Authentication

- Popup: **Sign in with Google** (Supabase OAuth + PKCE, `chrome.identity`).
- Sessions live in `chrome.storage.local`; API calls use `Authorization: Bearer`.
- Configure Supabase redirect URL for the extension — see [docs/extension-auth.md](docs/extension-auth.md).

## Required API routes in `knight-devs-platform`

- `GET /api/extension/public-config` — bootstrap Supabase URL + anon key for the extension
- `GET /api/extension/profiles`
- `GET /api/extension/autofill-candidate?profileId=...`
- `POST /api/extension/telemetry`

## Development

```bash
npm install
npm run build
```

`npm run build` runs TypeScript, then **esbuild** bundles `src/background.ts` into `dist/src/background.js`. The service worker must be bundled: Chrome cannot load `import "@supabase/supabase-js"` from `node_modules`, which otherwise causes **Service worker registration failed (status code: 15)**.

Then load unpacked extension in Chrome using this folder.

## Testing

```bash
npm run build:test
```
