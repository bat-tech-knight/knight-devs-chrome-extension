import { isContextAlive } from "../lib/extension-context.js";
import { sendExtensionMessage } from "../lib/extension-messaging.js";
import { collectPageExcerpt } from "./ai-fill.js";
import { autofillLog } from "./autofill-log.js";
import { fillTextInput } from "./fill-engine.js";
import { collectFieldExcerpt } from "./field-metadata.js";

function isTextareaUsable(ta: HTMLTextAreaElement): boolean {
  try {
    if (ta.disabled || ta.readOnly) return false;
    const st = window.getComputedStyle(ta);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = ta.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch {
    return false;
  }
}

async function requestCoverLetterAi(params: {
  profileId: string;
  pageTitle: string;
  pageUrl: string;
  pageExcerpt: string;
  fieldExcerpt: string;
  maxChars?: number;
}): Promise<string> {
  if (!isContextAlive()) throw new Error("Extension context invalidated.");
  const res = await sendExtensionMessage<{
    ok?: boolean;
    error?: string;
    text?: string;
  }>({
    type: "SUGGEST_FIELD_FOR_AUTOFILL",
    profileId: params.profileId,
    intent: "cover_letter",
    pageTitle: params.pageTitle,
    pageUrl: params.pageUrl,
    pageExcerpt: params.pageExcerpt,
    fieldExcerpt: params.fieldExcerpt,
    maxChars: params.maxChars ?? 5200,
  });
  if (!res || res.ok === false) {
    throw new Error(typeof res?.error === "string" ? res.error : "Cover letter AI failed");
  }
  return String(res.text ?? "").trim();
}

/**
 * Reveal textarea via "Enter manually" if needed, then return a usable textarea.
 */
export async function openManualCoverLetterTextarea(opts: {
  findTextarea: () => HTMLTextAreaElement | null;
  manualButton: HTMLButtonElement | null;
  pollMs?: number;
  maxPolls?: number;
}): Promise<HTMLTextAreaElement | null> {
  const { findTextarea, manualButton, pollMs = 80, maxPolls = 25 } = opts;

  let ta = findTextarea();
  if (ta && isTextareaUsable(ta)) return ta;

  if (manualButton) {
    manualButton.click();
    for (let i = 0; i < maxPolls; i += 1) {
      await new Promise((r) => setTimeout(r, pollMs));
      ta = findTextarea();
      if (ta && isTextareaUsable(ta)) return ta;
    }
  }

  ta = findTextarea();
  if (ta && isTextareaUsable(ta)) return ta;
  return null;
}

export async function fillCoverLetterWithAiAndFallback(params: {
  profileId: string;
  fieldRoot: HTMLElement | null;
  manualButton: HTMLButtonElement | null;
  findTextarea: () => HTMLTextAreaElement | null;
  fallbackText?: string;
  logPrefix?: string;
}): Promise<boolean> {
  const { profileId, fieldRoot, manualButton, findTextarea, fallbackText, logPrefix = "Cover letter" } = params;
  const page = collectPageExcerpt(6000);
  const excerptOk = page.excerpt.trim().length >= 80;

  let body = "";
  if (excerptOk) {
    try {
      const fieldExcerpt = collectFieldExcerpt(fieldRoot ?? document.body, 2800);
      body = await requestCoverLetterAi({
        profileId,
        pageTitle: page.title,
        pageUrl: page.url,
        pageExcerpt: page.excerpt,
        fieldExcerpt,
        maxChars: 5200,
      });
      autofillLog(`${logPrefix}: AI draft received`, { length: body.length });
    } catch (e) {
      autofillLog(`${logPrefix}: AI draft failed`, {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    autofillLog(`${logPrefix}: page excerpt too short for AI`, {});
  }

  if (!body.trim() && fallbackText?.trim()) {
    body = fallbackText.trim();
    autofillLog(`${logPrefix}: using profile summary fallback`, { length: body.length });
  }

  if (!body.trim()) {
    autofillLog(`${logPrefix}: no text to fill`, {});
    return false;
  }

  const ta = await openManualCoverLetterTextarea({
    findTextarea,
    manualButton,
  });

  if (!ta) {
    autofillLog(`${logPrefix}: textarea not found`, {});
    return false;
  }

  return fillTextInput(ta, body);
}

/** Greenhouse / Remix-style cover letter file-upload + manual. */
export async function tryGreenhouseCoverLetterAi(candidate: {
  profileId: string;
  summary?: string;
  resumeText?: string;
}): Promise<boolean> {
  const fieldRoot =
    document.querySelector("#upload-label-cover_letter")?.closest(".field-wrapper") ??
    document.querySelector('[aria-labelledby="upload-label-cover_letter"]')?.closest(".field-wrapper") ??
    null;

  const manualBtn =
    document.querySelector<HTMLButtonElement>("button[data-testid='cover_letter-text']") ??
    (fieldRoot
      ? Array.from(fieldRoot.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
          (b.textContent || "").toLowerCase().includes("enter manually")
        ) ?? null
      : null);

  const findTa = (): HTMLTextAreaElement | null => {
    const byId = document.querySelector<HTMLTextAreaElement>("#cover_letter_text");
    if (byId && !byId.disabled && !byId.readOnly) return byId;
    const named = document.querySelector<HTMLTextAreaElement>(
      "textarea[name='cover_letter_text'], textarea[name*='cover_letter'][name*='text' i]"
    );
    if (named && !named.disabled && !named.readOnly) return named;
    if (fieldRoot) {
      const inner = fieldRoot.querySelector<HTMLTextAreaElement>("textarea");
      if (inner && !inner.disabled && !inner.readOnly) return inner;
    }
    return null;
  };

  const fallback = (candidate.summary || candidate.resumeText)?.trim();

  return fillCoverLetterWithAiAndFallback({
    profileId: candidate.profileId,
    fieldRoot: fieldRoot instanceof HTMLElement ? fieldRoot : null,
    manualButton: manualBtn,
    findTextarea: findTa,
    fallbackText: fallback,
    logPrefix: "Greenhouse: cover letter",
  });
}

/** Best-effort on non-Greenhouse application pages with similar markup. */
export async function tryGenericCoverLetterAi(candidate: {
  profileId: string;
  summary?: string;
  resumeText?: string;
}): Promise<boolean> {
  const hint = `${window.location.pathname}${window.location.search}`.toLowerCase();
  if (!/apply|application|career|job|position/i.test(hint)) {
    return false;
  }

  let manualBtn: HTMLButtonElement | null = document.querySelector("button[data-testid='cover_letter-text']");
  let fieldRoot: HTMLElement | null =
    document.querySelector("#upload-label-cover_letter")?.closest(".field-wrapper") ?? null;

  if (!manualBtn) {
    for (const group of Array.from(document.querySelectorAll(".file-upload[role='group']"))) {
      const labelEl =
        group.querySelector("[id^='upload-label']") ?? group.querySelector(".upload-label, .label");
      const labelText = (labelEl?.textContent || "").toLowerCase();
      if (!labelText.includes("cover")) continue;
      const btn = Array.from(group.querySelectorAll("button")).find((b) =>
        (b.textContent || "").toLowerCase().includes("enter manually")
      );
      if (btn instanceof HTMLButtonElement) {
        manualBtn = btn;
        fieldRoot = group instanceof HTMLElement ? group : null;
        break;
      }
    }
  }

  const findTa = (): HTMLTextAreaElement | null => {
    const byId = document.querySelector<HTMLTextAreaElement>("#cover_letter_text");
    if (byId && !byId.disabled && !byId.readOnly) return byId;
    const named = document.querySelector<HTMLTextAreaElement>(
      "textarea[name='cover_letter_text'], textarea[name*='cover_letter']"
    );
    if (named && !named.disabled && !named.readOnly) return named;
    if (fieldRoot) {
      const inner = fieldRoot.querySelector<HTMLTextAreaElement>("textarea");
      if (inner && !inner.disabled && !inner.readOnly) return inner;
    }
    return null;
  };

  if (!manualBtn && !findTa()) {
    return false;
  }

  const fallback = (candidate.summary || candidate.resumeText)?.trim();

  return fillCoverLetterWithAiAndFallback({
    profileId: candidate.profileId,
    fieldRoot,
    manualButton: manualBtn,
    findTextarea: findTa,
    fallbackText: fallback,
    logPrefix: "Generic: cover letter",
  });
}
