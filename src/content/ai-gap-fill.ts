import type { SavedApplicationAnswerRow } from "../lib/api-client.js";
import {
  EXTENSION_CONTEXT_INVALIDATED_HINT,
  isContextAlive,
  isExtensionContextInvalidatedError,
} from "../lib/extension-context.js";
import { sendExtensionMessage } from "../lib/extension-messaging.js";
import type { SupportedSite } from "../lib/schema.js";
import { autofillLog } from "./autofill-log.js";
import { detectBuiltinFieldKey } from "./builtin-field-detect.js";
import { inferAiDraftMaxChars } from "./field-assist.js";
import { buildAssistQuestionPayload, collectFieldExcerpt } from "./field-metadata.js";
import { collectFormFillTargets } from "./saved-answers-merge.js";
import { collectPageExcerpt } from "./ai-fill.js";
import { fillTextInput } from "./fill-engine.js";

const MAX_FIELDS_PER_RUN = 12;

function isEmptyTextControl(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  return !(el.value ?? "").trim();
}

/** Open-ended / long-form prompts only — skip short labels (name, email, etc.). */
function isLikelyOpenQuestion(el: HTMLInputElement | HTMLTextAreaElement, label: string): boolean {
  const L = label.trim();
  if (L.length < 14) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  const hints =
    /sentence|paragraph|describe|explain|tell us|why\b|how (did|would|do)|challenge|project|experience|elaborate|additional|anything else|comments?/i;
  if (hints.test(L)) return true;
  return L.length >= 52;
}

async function extMessage<T>(payload: unknown): Promise<T> {
  if (!isContextAlive()) throw new Error("Extension context invalidated.");
  const response = await sendExtensionMessage<T & { ok?: boolean; error?: string; text?: string }>(payload);
  if (!response || (response as { ok?: boolean }).ok === false) {
    throw new Error((response as { error?: string })?.error ?? "Unknown error");
  }
  return response as T;
}

function savedKeysSet(rows: SavedApplicationAnswerRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.answer_text?.trim()) s.add(r.question_key);
  }
  return s;
}

/**
 * After profile + saved-answer merge: AI-draft empty open-ended fields that have no saved row,
 * fill them, and upsert the draft as a saved answer.
 */
export async function applyAiGapFill(
  site: SupportedSite,
  profileId: string,
  savedRows: SavedApplicationAnswerRow[]
): Promise<number> {
  if (site === "generic") {
    const hint = `${window.location.pathname}${window.location.search}`.toLowerCase();
    if (!/apply|application|career|job|position/i.test(hint)) {
      autofillLog("aiGapFill: skip generic (URL does not look like application)", {});
      return 0;
    }
  }

  const page = collectPageExcerpt(6000);
  if ((page.excerpt ?? "").trim().length < 80) {
    autofillLog("aiGapFill: page excerpt too short", {});
    return 0;
  }

  const keysWithSaved = savedKeysSet(savedRows);
  const targets = collectFormFillTargets(site);
  let applied = 0;

  for (const el of targets) {
    if (applied >= MAX_FIELDS_PER_RUN) break;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
    if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") continue;
    if (el.disabled || el.readOnly) continue;
    if (!isEmptyTextControl(el)) continue;

    const bk = detectBuiltinFieldKey(el);
    if (bk) continue;

    const payload = await buildAssistQuestionPayload(el);
    if (keysWithSaved.has(payload.questionKey)) continue;

    if (!isLikelyOpenQuestion(el, payload.labelSnapshot)) continue;

    const fieldExcerpt = collectFieldExcerpt(el, 2800);
    const maxChars = inferAiDraftMaxChars(payload.labelSnapshot, el);

    let text: string;
    try {
      const res = await extMessage<{ text?: string }>({
        type: "SUGGEST_FIELD_FOR_AUTOFILL",
        profileId,
        intent: "open_question",
        pageTitle: page.title,
        pageUrl: page.url,
        pageExcerpt: page.excerpt,
        fieldExcerpt,
        fieldHint: payload.labelSnapshot,
        ...(maxChars != null ? { maxChars } : {}),
      });
      text = String(res.text ?? "").trim();
    } catch (e) {
      if (isExtensionContextInvalidatedError(e)) throw e;
      autofillLog("aiGapFill: suggest failed", {
        message: e instanceof Error ? e.message : String(e),
        key: payload.questionKey.slice(0, 80),
      });
      continue;
    }

    if (!text) continue;

    if (!fillTextInput(el, text)) {
      autofillLog("aiGapFill: fill failed", { key: payload.questionKey.slice(0, 80) });
      continue;
    }

    try {
      await extMessage({
        type: "UPSERT_SAVED_ANSWER",
        profileId,
        answerText: text,
        labelSnapshot: payload.labelSnapshot,
        source: payload.source,
        hostname: payload.hostname,
        externalFieldId: payload.externalFieldId,
        questionKey: payload.questionKey,
      });
      keysWithSaved.add(payload.questionKey);
      applied += 1;
      autofillLog("aiGapFill: filled and saved", { key: payload.questionKey.slice(0, 80) });
    } catch (e) {
      if (isExtensionContextInvalidatedError(e)) throw e;
      autofillLog("aiGapFill: upsert failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return applied;
}
