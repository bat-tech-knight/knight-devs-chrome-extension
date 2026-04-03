import type { SavedApplicationAnswerRow } from "../lib/api-client.js";
import type { SupportedSite } from "../lib/schema.js";
import { buildBuiltinQuestionKey, buildQuestionKey } from "../lib/question-key.js";
import { detectBuiltinFieldKey } from "./builtin-field-detect.js";
import { autofillLog } from "./autofill-log.js";
import {
  fillRadioGroupBySavedAnswer,
  fillSelectBySavedAnswer,
  fillTextInput,
  tryFillReactSelect,
} from "./fill-engine.js";
import { getExternalFieldId, getFieldLabelSnapshot, siteSourceFromHost } from "./field-metadata.js";

function isFillableTextControl(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  const t = (el.type || "text").toLowerCase();
  const ok = new Set(["text", "email", "tel", "url", "search", ""]);
  return ok.has(t);
}

function isFillableSelect(el: Element): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement && !el.disabled && !el.multiple;
}

function isFillableRadio(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type.toLowerCase() === "radio" && !el.disabled;
}

function radiosInNameGroup(r: HTMLInputElement): HTMLInputElement[] {
  if (!r.name.trim()) return [r];
  const scope: Document | HTMLFormElement = r.form ?? r.ownerDocument;
  return Array.from(scope.querySelectorAll("input[type='radio']:not([disabled])")).filter(
    (n): n is HTMLInputElement => n instanceof HTMLInputElement && n.name === r.name
  );
}

export function collectFormFillTargets(
  site: SupportedSite
): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  let root: Document | Element = document;
  if (site === "greenhouse") {
    const f = document.querySelector("#application-form");
    if (f) root = f;
  } else if (site === "lever") {
    const f = document.querySelector("form[class*='application'], form#application-form, main form");
    if (f) root = f;
  }

  const out: (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] = [];

  for (const n of Array.from(root.querySelectorAll("input[type='radio']"))) {
    if (!isFillableRadio(n)) continue;
    if (n.offsetParent === null && n !== document.activeElement) {
      try {
        const st = window.getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") continue;
      } catch {
        continue;
      }
    }
    out.push(n);
  }

  for (const n of Array.from(root.querySelectorAll("input, textarea"))) {
    if (!isFillableTextControl(n)) continue;
    if (n.offsetParent === null && n !== document.activeElement) {
      try {
        const st = window.getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") continue;
      } catch {
        continue;
      }
    }
    out.push(n);
  }

  for (const n of Array.from(root.querySelectorAll("select"))) {
    if (!isFillableSelect(n)) continue;
    if (n.offsetParent === null && n !== document.activeElement) {
      try {
        const st = window.getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") continue;
      } catch {
        continue;
      }
    }
    out.push(n);
  }

  return out;
}

/**
 * After profile autofill, fill any custom questions that match saved_application_answers keys.
 */
export async function applyMatchingSavedAnswers(
  rows: SavedApplicationAnswerRow[],
  site: SupportedSite
): Promise<number> {
  if (!rows.length) return 0;

  if (site === "generic") {
    const hint = `${window.location.pathname}${window.location.search}`.toLowerCase();
    if (!/apply|application|career|job|position/i.test(hint)) {
      autofillLog("savedAnswersMerge: skip generic site (URL does not look like an application form)", {});
      return 0;
    }
  }

  const byKey = new Map<string, string>();
  for (const r of rows) {
    if (r.answer_text?.trim()) byKey.set(r.question_key, r.answer_text);
  }
  if (!byKey.size) return 0;

  const hostname = window.location.hostname.trim().toLowerCase() || "unknown";
  const source = siteSourceFromHost(hostname);
  let applied = 0;

  const targets = collectFormFillTargets(site);
  autofillLog("savedAnswersMerge: candidates", { count: targets.length, site });

  const seenRadioGroups = new Set<string>();

  for (const el of targets) {
    if (el instanceof HTMLInputElement && el.type.toLowerCase() === "radio" && el.name.trim()) {
      const gk = `${el.form?.id || ""}::${el.name}`;
      if (seenRadioGroups.has(gk)) continue;
      seenRadioGroups.add(gk);
    }

    const labelSnapshot = getFieldLabelSnapshot(el);
    const externalFieldId = getExternalFieldId(el);
    const key = await buildQuestionKey({
      source,
      hostname,
      externalFieldId,
      labelText: labelSnapshot,
    });
    let answer = byKey.get(key);
    if (!answer?.trim()) {
      const bk = detectBuiltinFieldKey(el);
      if (bk) answer = byKey.get(buildBuiltinQuestionKey(bk));
    }
    if (!answer?.trim()) continue;

    let ok = false;
    if (el instanceof HTMLInputElement && el.type.toLowerCase() === "radio") {
      const group = radiosInNameGroup(el);
      ok = fillRadioGroupBySavedAnswer(group, answer);
    } else if (el instanceof HTMLSelectElement) {
      ok = fillSelectBySavedAnswer(el, answer);
    } else if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") {
      autofillLog("savedAnswersMerge: react-select combobox", { id: el.id || null });
      ok = await tryFillReactSelect(el, answer, answer);
      await new Promise((r) => setTimeout(r, 100));
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      ok = fillTextInput(el, answer);
    }

    if (ok) {
      applied += 1;
      autofillLog("savedAnswersMerge: filled", { key: key.slice(0, 80) });
    }
  }

  return applied;
}
