import type { SupportedSite } from "../lib/schema.js";
import { buildQuestionKey } from "../lib/question-key.js";

export function siteSourceFromHost(hostname: string): SupportedSite {
  const h = hostname.toLowerCase();
  if (h.includes("greenhouse")) return "greenhouse";
  if (h.includes("lever")) return "lever";
  return "generic";
}

function textFromIds(root: Document, ids: string): string {
  const parts: string[] = [];
  for (const id of ids.split(/\s+/).filter(Boolean)) {
    const el = root.getElementById(id);
    if (el?.textContent?.trim()) parts.push(el.textContent.trim());
  }
  return parts.join(" ");
}

/**
 * Human-readable label for display + hashing when no stable field id exists.
 */
export function getFieldLabelSnapshot(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria.slice(0, 2000);

  const labelledBy = el.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const t = textFromIds(el.ownerDocument, labelledBy);
    if (t) return t.slice(0, 2000);
  }

  if (el.id) {
    const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const lt = lab?.textContent?.trim();
    if (lt) return lt.replace(/\s*\*\s*$/, "").trim().slice(0, 2000);
  }

  const closestLabel = el.closest("label");
  if (closestLabel) {
    const t = closestLabel.textContent?.trim();
    if (t) return t.replace(/\s*\*\s*$/, "").trim().slice(0, 2000);
  }

  const wrap =
    el.closest(".field-wrapper, .text-input-wrapper, .input-wrapper, [class*='field'], .application-field") ??
    el.parentElement;
  if (wrap) {
    const t = wrap.textContent?.trim().replace(/\s+/g, " ");
    if (t) return t.slice(0, 2000);
  }

  return (el.getAttribute("name") || el.getAttribute("placeholder") || "Question").slice(0, 2000);
}

export function getExternalFieldId(el: HTMLElement): string | null {
  const id = el.id?.trim();
  return id || null;
}

export async function buildAssistQuestionPayload(el: HTMLElement): Promise<{
  questionKey: string;
  labelSnapshot: string;
  source: string;
  hostname: string;
  externalFieldId: string | null;
}> {
  const hostname = window.location.hostname.trim().toLowerCase() || "unknown";
  const source = siteSourceFromHost(hostname);
  const labelSnapshot = getFieldLabelSnapshot(el);
  const externalFieldId = getExternalFieldId(el);
  const questionKey = await buildQuestionKey({
    source,
    hostname,
    externalFieldId,
    labelText: labelSnapshot,
  });
  return { questionKey, labelSnapshot, source, hostname, externalFieldId };
}

/** Local context around the field for AI (job title + nearby copy). */
export function collectFieldExcerpt(el: HTMLElement, maxChars: number): string {
  const title = document.title || "";
  const wrap =
    el.closest(".field-wrapper, .application--question, .application-field, fieldset, form") ??
    el.parentElement;
  const textHost = wrap instanceof HTMLElement ? wrap : el;
  let body = "";
  try {
    body = (textHost.innerText || "").replace(/\s+/g, " ").trim();
  } catch {
    body = "";
  }
  const combined = `Page title: ${title}\n\n${body}`.trim();
  return combined.length <= maxChars ? combined : combined.slice(0, maxChars);
}
