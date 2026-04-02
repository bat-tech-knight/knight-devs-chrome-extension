const SESSION_KEY = "knightDevsExtensionSession";

export interface ExtensionSessionUser {
  id: string;
  email: string | null;
}

export interface ExtensionSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user?: ExtensionSessionUser;
}

/** Shape returned from Next.js auth routes (subset of Supabase session fields). */
interface AuthApiSessionPayload {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: ExtensionSessionUser;
}

function normalizeBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/$/, "");
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(response.ok ? "Invalid JSON from server" : text || response.statusText);
  }
}

async function clearLegacySupabaseKeys(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all ?? {}).filter(
    (k) => k.startsWith("sb-") && k.includes("auth-token")
  );
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function loadStoredSession(): Promise<ExtensionSession | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const raw = stored[SESSION_KEY] as ExtensionSession | undefined;
  if (!raw?.access_token || !raw?.refresh_token) return null;
  return raw;
}

export async function saveSession(session: ExtensionSession): Promise<void> {
  await clearLegacySupabaseKeys();
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
  await clearLegacySupabaseKeys();
}

function shouldRefresh(session: ExtensionSession): boolean {
  if (session.expires_at == null) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= session.expires_at - 120;
}

export async function loginViaApi(
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<ExtensionSession> {
  const base = normalizeBase(apiBaseUrl);
  const response = await fetch(`${base}/api/extension/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });

  const payload = await readJson<{
    success?: boolean;
    data?: AuthApiSessionPayload;
    error?: string;
  }>(response);

  if (!response.ok || !payload.data?.access_token || !payload.data?.refresh_token) {
    throw new Error(payload.error ?? "Sign-in failed");
  }

  const d = payload.data;
  const expiresAt =
    d.expires_at ??
    (typeof d.expires_in === "number"
      ? Math.floor(Date.now() / 1000) + d.expires_in
      : undefined);

  const session: ExtensionSession = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: expiresAt,
    user: d.user,
  };
  await saveSession(session);
  return session;
}

async function refreshViaApi(apiBaseUrl: string, refresh_token: string): Promise<ExtensionSession> {
  const base = normalizeBase(apiBaseUrl);
  const response = await fetch(`${base}/api/extension/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });

  const payload = await readJson<{
    success?: boolean;
    data?: AuthApiSessionPayload;
    error?: string;
  }>(response);

  if (!response.ok || !payload.data?.access_token || !payload.data?.refresh_token) {
    throw new Error(payload.error ?? "Session refresh failed");
  }

  const d = payload.data;
  const expiresAt =
    d.expires_at ??
    (typeof d.expires_in === "number"
      ? Math.floor(Date.now() / 1000) + d.expires_in
      : undefined);

  const session: ExtensionSession = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: expiresAt,
    user: d.user,
  };
  await saveSession(session);
  return session;
}

export async function logoutViaApi(apiBaseUrl: string, accessToken: string): Promise<void> {
  const base = normalizeBase(apiBaseUrl);
  try {
    await fetch(`${base}/api/extension/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Returns a valid access token, refreshing via Next.js when near expiry.
 */
export async function getValidAccessToken(apiBaseUrl: string): Promise<string | null> {
  let session = await loadStoredSession();
  if (!session) return null;

  try {
    if (shouldRefresh(session)) {
      session = await refreshViaApi(apiBaseUrl, session.refresh_token);
    }
    return session.access_token;
  } catch {
    await clearSession();
    return null;
  }
}
