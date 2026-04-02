import { fillSelectBySavedAnswer, fillTextInput, tryFillReactSelect } from "./fill-engine.js";
import { getFieldAssistTarget } from "./field-assist-target.js";

export function collectPageExcerpt(maxChars: number): { title: string; url: string; excerpt: string } {
  const title = document.title || "";
  const url = window.location.href;
  let excerpt = "";
  try {
    excerpt = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  } catch {
    excerpt = "";
  }
  if (excerpt.length > maxChars) {
    excerpt = excerpt.slice(0, maxChars);
  }
  return { title, url, excerpt };
}

/**
 * Prefer the focused field; otherwise the largest empty textarea.
 * React-Select comboboxes use tryFillReactSelect (async).
 */
export async function applyAiSuggestion(text: string): Promise<boolean> {
  if (!text.trim()) return false;

  const pinned = getFieldAssistTarget();
  if (pinned && pinned.isConnected && !pinned.disabled) {
    if (pinned instanceof HTMLSelectElement && !pinned.multiple) {
      return fillSelectBySavedAnswer(pinned, text);
    }
    if (
      pinned instanceof HTMLInputElement &&
      !pinned.readOnly &&
      pinned.getAttribute("role") === "combobox"
    ) {
      return tryFillReactSelect(pinned, text, text);
    }
    if (pinned instanceof HTMLTextAreaElement && !pinned.readOnly) {
      return fillTextInput(pinned, text);
    }
    if (pinned instanceof HTMLInputElement && !pinned.readOnly) {
      const t = (pinned.type || "text").toLowerCase();
      if (["text", "email", "tel", "url", "search", ""].includes(t)) {
        return fillTextInput(pinned, text);
      }
    }
  }

  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement &&
    el.getAttribute("role") === "combobox" &&
    !el.disabled &&
    !el.readOnly
  ) {
    return tryFillReactSelect(el, text, text);
  }
  if (el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly) {
    return fillTextInput(el, text);
  }
  if (el instanceof HTMLInputElement) {
    const t = (el.type || "text").toLowerCase();
    if ((t === "text" || t === "search" || t === "") && !el.disabled && !el.readOnly) {
      return fillTextInput(el, text);
    }
  }

  const areas = Array.from(document.querySelectorAll("textarea")).filter(
    (a) => a instanceof HTMLTextAreaElement && !a.disabled && !a.readOnly && !(a.value || "").trim()
  ) as HTMLTextAreaElement[];

  let best: HTMLTextAreaElement | null = null;
  let bestScore = -1;
  for (const a of areas) {
    const score = a.rows * Math.max(1, a.cols);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (best) {
    return fillTextInput(best, text);
  }
  return false;
}
