import type { ExpertProfileOption } from "./schema.js";

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function fetchProfiles(apiBaseUrl: string, accessToken: string): Promise<ExpertProfileOption[]> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/extension/profiles`, {
    headers: authHeaders(accessToken),
  });
  const payload = (await response.json()) as ApiEnvelope<ExpertProfileOption[]>;
  if (!response.ok) throw new Error(payload.error ?? "Failed to load profiles");
  return payload.data ?? [];
}

export interface SavedApplicationAnswerRow {
  id: string;
  profile_id: string;
  question_key: string;
  label_snapshot: string;
  answer_text: string;
  source: string;
  hostname: string | null;
  external_field_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchSavedAnswersList(
  apiBaseUrl: string,
  accessToken: string,
  profileId: string
): Promise<SavedApplicationAnswerRow[]> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/extension/saved-answers?profileId=${encodeURIComponent(profileId)}`,
    { headers: authHeaders(accessToken) }
  );
  const payload = (await response.json()) as ApiEnvelope<SavedApplicationAnswerRow[]>;
  if (!response.ok) throw new Error(payload.error ?? "Failed to load saved answers");
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function lookupSavedAnswer(
  apiBaseUrl: string,
  accessToken: string,
  profileId: string,
  questionKey: string
): Promise<SavedApplicationAnswerRow | null> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/extension/saved-answers?profileId=${encodeURIComponent(profileId)}&questionKey=${encodeURIComponent(questionKey)}`,
    { headers: authHeaders(accessToken) }
  );
  const payload = (await response.json()) as ApiEnvelope<SavedApplicationAnswerRow | null>;
  if (!response.ok) throw new Error(payload.error ?? "Lookup failed");
  return payload.data ?? null;
}

/** Profile-backed standard fields (`knightdevs:builtin:*`), e.g. first_name, email. */
export async function lookupSavedAnswerBuiltin(
  apiBaseUrl: string,
  accessToken: string,
  profileId: string,
  builtinKey: string
): Promise<SavedApplicationAnswerRow | null> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/extension/saved-answers?profileId=${encodeURIComponent(profileId)}&builtinKey=${encodeURIComponent(builtinKey)}`,
    { headers: authHeaders(accessToken) }
  );
  const payload = (await response.json()) as ApiEnvelope<SavedApplicationAnswerRow | null>;
  if (!response.ok) throw new Error(payload.error ?? "Builtin lookup failed");
  return payload.data ?? null;
}

export async function upsertSavedAnswer(
  apiBaseUrl: string,
  accessToken: string,
  body: {
    profileId: string;
    answerText: string;
    labelSnapshot: string;
    source: string;
    hostname: string;
    externalFieldId?: string | null;
    questionKey?: string;
  }
): Promise<SavedApplicationAnswerRow> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/extension/saved-answers`, {
    method: "PUT",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiEnvelope<SavedApplicationAnswerRow>;
  if (!response.ok || !payload.data) throw new Error(payload.error ?? "Save failed");
  return payload.data;
}

export async function fetchCandidateRaw(
  apiBaseUrl: string,
  accessToken: string,
  profileId: string
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/api/extension/autofill-candidate?profileId=${encodeURIComponent(profileId)}`,
    { headers: authHeaders(accessToken) }
  );
  const payload = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
  if (!response.ok || !payload.data) throw new Error(payload.error ?? "Failed to load candidate data");
  return payload.data;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    for (let j = 0; j < sub.length; j += 1) {
      binary += String.fromCharCode(sub[j]!);
    }
  }
  return btoa(binary);
}

function filenameFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "resume.pdf";
  if (m.includes("wordprocessingml")) return "resume.docx";
  if (m.includes("msword")) return "resume.doc";
  if (m.includes("text/plain")) return "resume.txt";
  return "resume";
}

/**
 * Download resume bytes via platform proxy (Bearer auth). Throws Error with message NO_RESUME_FILE if none.
 */
export async function fetchResumeFileForAutofill(
  apiBaseUrl: string,
  accessToken: string,
  profileId: string
): Promise<{ base64: string; mimeType: string; filename: string }> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/extension/resume-file?profileId=${encodeURIComponent(profileId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.status === 404) {
    throw new Error("NO_RESUME_FILE");
  }
  if (!response.ok) {
    let errMsg = "Resume download failed";
    try {
      const j = (await response.json()) as { error?: string };
      if (j.error) errMsg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(errMsg);
  }
  const mimeType = response.headers.get("content-type") || "application/pdf";
  const fn = response.headers.get("x-resume-filename")?.trim();
  const filename = fn && fn.length > 0 ? fn : filenameFromMime(mimeType);
  const buf = await response.arrayBuffer();
  return {
    base64: arrayBufferToBase64(buf),
    mimeType,
    filename,
  };
}

export async function sendTelemetry(
  apiBaseUrl: string,
  accessToken: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/extension/telemetry`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ eventType, data }),
    });
  } catch {
    // Non-critical failure.
  }
}

export type SuggestFieldIntent = "open_question" | "cover_letter" | "why_role";

export async function suggestFieldDraft(
  apiBaseUrl: string,
  accessToken: string,
  body: {
    profileId: string;
    intent: SuggestFieldIntent;
    pageTitle: string;
    pageUrl: string;
    pageExcerpt: string;
    fieldExcerpt?: string;
    fieldHint?: string;
    maxChars?: number;
  }
): Promise<string> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/extension/suggest-field`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string; text?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "AI draft failed");
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new Error("Empty AI response");
  }
  return text;
}
