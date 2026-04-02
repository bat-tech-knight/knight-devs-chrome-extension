/** Browser-safe; must match knight-devs-platform `lib/question-key.ts` / `question-key-browser.ts`. */

export function normalizeLabelForKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildQuestionKey(params: {
  source: string;
  hostname: string;
  externalFieldId?: string | null;
  labelText: string;
}): Promise<string> {
  const host = (params.hostname || "").trim().toLowerCase() || "unknown";
  const src = (params.source || "generic").trim().toLowerCase() || "generic";
  const ext = (params.externalFieldId || "").trim();
  if (ext) {
    return `${src}:${host}:${ext}`;
  }
  const norm = normalizeLabelForKey(params.labelText || "untitled");
  return `${src}:${host}:label:${await sha256Hex(norm)}`;
}

/** Must match `buildBuiltinQuestionKey` in knight-devs-platform `lib/question-key.ts`. */
export function buildBuiltinQuestionKey(fieldKey: string): string {
  const k = fieldKey.trim().toLowerCase();
  return `knightdevs:builtin:${k}`;
}
