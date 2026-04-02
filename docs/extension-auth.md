# Extension authentication

The extension is a **standalone client**: it signs in with **Supabase OAuth (PKCE)** and calls Knight Devs API routes with `Authorization: Bearer <access_token>`. It does not rely on being logged into the web app in a tab.

## Flow

1. Extension loads public Supabase settings from `GET /api/extension/public-config` (anon key + URL; safe to expose).
2. User clicks **Sign in with Google** in the popup.
3. `chrome.identity.launchWebAuthFlow` completes the OAuth redirect.
4. Supabase session (access + refresh tokens) is stored in `chrome.storage.local`.
5. API calls to `/api/extension/*` send `Authorization: Bearer`.

## Supabase dashboard setup

1. Enable **Google** (or change code to another provider) under **Authentication → Providers**.
2. Under **Authentication → URL configuration**, add this to **Redirect URLs**:

   `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`

   Find `<YOUR_EXTENSION_ID>` on `chrome://extensions` (Developer mode) after loading the unpacked extension.

3. Ensure your Knight Devs app Site URL matches your deployed URL (e.g. `http://localhost:3000` for local dev).

## Fallback

API routes also accept the normal **browser cookie session** (same as the web app) for debugging, but the extension uses Bearer tokens in normal operation.

## Troubleshooting: “Service worker registration failed (status code: 15)”

Usually the background script failed to load or threw on startup. The most common cause here is an **unbundled** `dist/src/background.js` that still contains `import … from "@supabase/supabase-js"` — Chrome extensions do not resolve npm packages from `node_modules`.

Fix: run a full build (`npm run build`), which runs `esbuild` to bundle the service worker. Do not load the extension without running `npm run build` after pulling changes.
