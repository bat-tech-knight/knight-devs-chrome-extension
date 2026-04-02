import { collectPageExcerpt } from "./ai-fill.js";
import { detectBuiltinFieldKey } from "./builtin-field-detect.js";
import type { FieldAssistTargetEl } from "./field-assist-target.js";
import { fillSelectBySavedAnswer, fillTextInput, tryFillReactSelect } from "./fill-engine.js";
import { buildAssistQuestionPayload, collectFieldExcerpt } from "./field-metadata.js";
import {
  EXTENSION_CONTEXT_INVALIDATED_HINT,
  isContextAlive,
  isExtensionContextInvalidatedError,
} from "../lib/extension-context.js";
import { sendExtensionMessage } from "../lib/extension-messaging.js";
import type { SavedApplicationAnswerRow } from "../lib/api-client.js";
import { getState } from "../lib/storage.js";
import { setFieldAssistTarget } from "./field-assist-target.js";

const Z = 2_147_483_640;

/** Chip size — keep in sync with chip inline styles below. */
const CHIP_W = 28;
const CHIP_H = 24;
const CHIP_GAP = 6;
/** Horizontal offset: chip sits this many px to the right of the field’s right edge. */
const CHIP_RIGHT_OF_FIELD = 12;

/**
 * React-Select / Remix comboboxes use a tiny real <input>; chip must anchor to the visible control.
 */
function getAssistLayoutRect(el: FieldAssistTargetEl): DOMRect {
  if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") {
    const shell =
      el.closest(".select__control") ||
      el.closest("[class*='select__control']") ||
      el.closest(".select-shell") ||
      el.closest(".field-wrapper");
    if (shell instanceof HTMLElement) {
      const r = shell.getBoundingClientRect();
      if (r.width >= 8 && r.height >= 8) return r;
    }
  }
  return el.getBoundingClientRect();
}

/**
 * Text to persist for "Save current". React-Select stores the label in `.select__single-value`, not `input.value`.
 */
function getAnswerTextForSave(el: FieldAssistTargetEl): string {
  if (el instanceof HTMLSelectElement) {
    const opt = el.selectedOptions[0];
    if (opt) return ((opt.textContent || "").trim() || opt.value).trim();
    return (el.value ?? "").trim();
  }

  if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") {
    const control =
      el.closest(".select__control") ??
      el.closest("[class*='select__control']") ??
      el.closest(".select__value-container");
    if (control) {
      const single = control.querySelector(
        ".select__single-value, [class*='select__single-value'], [class*='singleValue']"
      );
      const singleText = single?.textContent?.replace(/\s+/g, " ").trim();
      if (singleText) return singleText;

      const multiLabels = control.querySelectorAll(
        ".select__multi-value__label, [class*='multiValue__label']"
      );
      if (multiLabels.length) {
        const parts = Array.from(multiLabels)
          .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
    }
    return (el.value ?? "").trim();
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return (el.value ?? "").trim();
  }
  return "";
}

function isAssistEligible(el: Element | null): el is FieldAssistTargetEl {
  if (!el) return false;
  if (el instanceof HTMLSelectElement) {
    if (el.disabled || el.multiple) return false;
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return false;
  } else if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || "text").toLowerCase();
    const ok = new Set(["text", "email", "tel", "url", "search", ""]);
    const isCombobox = el.getAttribute("role") === "combobox";
    if (!ok.has(t) && !isCombobox) return false;
  } else {
    return false;
  }
  try {
    if (el.offsetParent === null && document.activeElement !== el) {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Rough character budget for AI draft from the label (e.g. "4-8 sentences") and field size.
 */
export function inferAiDraftMaxChars(labelSnapshot: string, el: FieldAssistTargetEl): number | undefined {
  const label = labelSnapshot.trim();
  const range = label.match(/\(?\s*(\d+)\s*-\s*(\d+)\s*sentences?\s*\)?/i);
  if (range) {
    const hi = parseInt(range[2], 10);
    if (!Number.isNaN(hi) && hi > 0) {
      return Math.min(8000, Math.max(500, hi * 135 + 400));
    }
  }
  const single = label.match(/\b(\d+)\s*sentences?\b/i);
  if (single) {
    const n = parseInt(single[1], 10);
    if (!Number.isNaN(n) && n > 0) {
      return Math.min(8000, Math.max(400, n * 135 + 250));
    }
  }
  if (el instanceof HTMLTextAreaElement) {
    const r = el.rows || 4;
    if (r >= 8) return 3600;
    if (r >= 6) return 3000;
    if (r >= 4) return 2400;
    return 2000;
  }
  return undefined;
}

async function bgMessage<T>(payload: unknown): Promise<T> {
  if (!isContextAlive()) throw new Error("Extension context invalidated.");
  const response = await sendExtensionMessage<T & { ok?: boolean; error?: string }>(payload);
  if (!response || (response as { ok?: boolean }).ok === false) {
    throw new Error((response as { error?: string })?.error ?? "Unknown error");
  }
  return response as T;
}

/**
 * Grammarly-style chip + panel: fill / save / AI draft for text fields and <select>.
 */
export function initFieldAssist(): void {
  let root: HTMLDivElement | null = null;
  let chip: HTMLButtonElement | null = null;
  let panel: HTMLDivElement | null = null;
  let statusEl: HTMLDivElement | null = null;
  let target: FieldAssistTargetEl | null = null;
  let panelOpen = false;
  let positionRaf = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureDom(): void {
    if (root) return;
    root = document.createElement("div");
    root.id = "kd-field-assist-root";
    Object.assign(root.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: String(Z),
    });

    chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = "KD";
    chip.setAttribute("aria-label", "Knight Devs field assist");
    Object.assign(chip.style, {
      position: "fixed",
      width: `${CHIP_W}px`,
      height: `${CHIP_H}px`,
      fontSize: "10px",
      fontWeight: "700",
      borderRadius: "5px",
      border: "1px solid #222",
      background: "#111",
      color: "#fff",
      cursor: "pointer",
      padding: "0",
      display: "none",
      pointerEvents: "auto",
      lineHeight: "22px",
    });

    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      display: "none",
      flexDirection: "column",
      gap: "8px",
      padding: "12px",
      minWidth: "210px",
      maxWidth: "300px",
      background: "#fff",
      border: "1px solid #ccc",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
      pointerEvents: "auto",
      fontFamily: "system-ui,-apple-system,sans-serif",
      fontSize: "12px",
      color: "#1a1a1a",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      marginBottom: "2px",
    });
    const headerTitle = document.createElement("span");
    headerTitle.textContent = "Knight Devs";
    Object.assign(headerTitle.style, {
      fontWeight: "600",
      fontSize: "12px",
      color: "#111",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close panel");
    Object.assign(closeBtn.style, {
      flexShrink: "0",
      width: "28px",
      height: "28px",
      padding: "0",
      lineHeight: "26px",
      fontSize: "18px",
      fontWeight: "400",
      border: "none",
      borderRadius: "6px",
      background: "transparent",
      color: "#666",
      cursor: "pointer",
    });
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "#f0f0f0";
      closeBtn.style.color = "#111";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "transparent";
      closeBtn.style.color = "#666";
    });
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    });
    closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    header.append(headerTitle, closeBtn);

    statusEl = document.createElement("div");
    statusEl.style.lineHeight = "1.35";
    statusEl.style.color = "#444";

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    });

    function mkBtn(label: string, primary: boolean): HTMLButtonElement {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      Object.assign(b.style, {
        padding: "7px 10px",
        borderRadius: "6px",
        border: primary ? "1px solid #111" : "1px solid #bbb",
        background: primary ? "#111" : "#f6f6f6",
        color: primary ? "#fff" : "#111",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: primary ? "600" : "500",
      });
      return b;
    }

    const fillBtn = mkBtn("Fill saved", true);
    const saveBtn = mkBtn("Save current", false);
    const aiBtn = mkBtn("AI draft", false);

    fillBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onFill();
    });
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onSave();
    });
    aiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onAi();
    });

    row.append(fillBtn, saveBtn, aiBtn);
    panel.append(header, statusEl, row);

    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void togglePanel();
    });

    chip.addEventListener("mousedown", (e) => e.preventDefault());

    root.append(chip, panel);
    document.documentElement.appendChild(root);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
  }

  function positionChip(): void {
    if (!chip || !target || chip.style.display === "none") return;
    const r = getAssistLayoutRect(target);
    if (r.width < 4 || r.height < 4) {
      chip.style.display = "none";
      return;
    }
    const pad = 4;

    // Outside bottom-right: below the field, shifted clearly to the right of the input.
    let left = r.right + CHIP_RIGHT_OF_FIELD;
    let top = r.bottom + CHIP_GAP;

    left = Math.max(pad, Math.min(left, window.innerWidth - pad - CHIP_W));

    if (top + CHIP_H > window.innerHeight - pad) {
      // Not enough room below — place to the right of the field, bottom-aligned.
      left = r.right + CHIP_RIGHT_OF_FIELD;
      top = r.bottom - CHIP_H;
      left = Math.max(pad, Math.min(left, window.innerWidth - pad - CHIP_W));
      top = Math.max(pad, Math.min(top, window.innerHeight - pad - CHIP_H));
    }

    if (left + CHIP_W > window.innerWidth - pad) {
      // Flush to right edge of viewport — tuck just under the field, left-shifted.
      left = Math.max(pad, window.innerWidth - pad - CHIP_W);
    }

    chip.style.left = `${left}px`;
    chip.style.top = `${top}px`;

    if (panel && panel.style.display === "flex") {
      const pw = 220;
      const chipBottom = top + CHIP_H;
      let pl = r.left;
      let pt = Math.max(r.bottom, chipBottom) + CHIP_GAP;
      if (pl + pw > window.innerWidth - 8) pl = window.innerWidth - pw - 8;
      if (pt + 120 > window.innerHeight - 8) pt = Math.max(8, Math.min(r.top, top) - 130);
      panel.style.left = `${Math.max(8, pl)}px`;
      panel.style.top = `${Math.max(8, pt)}px`;
    }
  }

  function schedulePosition(): void {
    if (positionRaf) cancelAnimationFrame(positionRaf);
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      positionChip();
    });
  }

  function showChipFor(el: FieldAssistTargetEl): void {
    ensureDom();
    target = el;
    if (chip) chip.style.display = "block";
    schedulePosition();
  }

  function hideAll(): void {
    closePanel();
    target = null;
    if (chip) chip.style.display = "none";
    if (panel) panel.style.display = "none";
  }

  function closePanel(): void {
    panelOpen = false;
    if (panel) panel.style.display = "none";
  }

  async function togglePanel(): Promise<void> {
    ensureDom();
    if (!panel || !target) return;
    panelOpen = !panelOpen;
    if (panelOpen) {
      panel.style.display = "flex";
      schedulePosition();
      await refreshStatus();
    } else {
      panel.style.display = "none";
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!statusEl || !target) return;
    statusEl.textContent = "Loading…";
    try {
      const state = await getState();
      if (state.fieldAssistEnabled === false) {
        statusEl.textContent = "Field assist is off (enable in extension popup).";
        return;
      }
      if (!state.activeProfileId) {
        statusEl.textContent = "Select an expert profile in the extension popup.";
        return;
      }
      const { questionKey } = await buildAssistQuestionPayload(target);
      const builtinKey = detectBuiltinFieldKey(target);
      const res = await bgMessage<{ ok: true; data: SavedApplicationAnswerRow | null }>({
        type: "LOOKUP_SAVED_ANSWER",
        profileId: state.activeProfileId,
        questionKey,
        builtinKey: builtinKey ?? undefined,
      });
      const row = res.data;
      statusEl.textContent = row?.answer_text?.trim()
        ? builtinKey && row.question_key?.startsWith("knightdevs:builtin:")
          ? "Profile value available (Fill to use)."
          : "Saved answer available for this question."
        : "No saved answer yet — type text and tap Save, or use AI draft.";
    } catch (e) {
      statusEl.textContent =
        e instanceof Error ? e.message : "Could not load saved answer.";
    }
  }

  async function onFill(): Promise<void> {
    if (!target) return;
    try {
      const state = await getState();
      if (!state.activeProfileId) throw new Error("Select a profile in the extension popup.");
      const payload = await buildAssistQuestionPayload(target);
      const builtinKey = detectBuiltinFieldKey(target);
      const res = await bgMessage<{ ok: true; data: SavedApplicationAnswerRow | null }>({
        type: "LOOKUP_SAVED_ANSWER",
        profileId: state.activeProfileId,
        questionKey: payload.questionKey,
        builtinKey: builtinKey ?? undefined,
      });
      const text = res.data?.answer_text?.trim();
      if (!text) {
        if (statusEl) {
          statusEl.textContent = builtinKey
            ? "No profile value for this field — update it under Settings → Profile."
            : "Nothing saved for this field yet.";
        }
        return;
      }
      let applied = false;
      if (target instanceof HTMLSelectElement) {
        applied = fillSelectBySavedAnswer(target, text);
        if (!applied && statusEl) {
          statusEl.textContent = "Saved text does not match any option in this dropdown.";
        }
      } else if (target instanceof HTMLInputElement && target.getAttribute("role") === "combobox") {
        applied = await tryFillReactSelect(target, text, text);
        if (!applied && statusEl) {
          statusEl.textContent =
            "Could not pick a matching option — open the dropdown or adjust the saved answer.";
        }
      } else {
        applied = fillTextInput(target, text);
      }
      if (!applied) return;
      void bgMessage({
        type: "SEND_TELEMETRY",
        eventType: "saved_answer_applied",
        data: { questionKey: payload.questionKey.slice(0, 120) },
      }).catch(() => {});
      closePanel();
    } catch (e) {
      if (statusEl) statusEl.textContent = e instanceof Error ? e.message : "Fill failed";
    }
  }

  async function onSave(): Promise<void> {
    if (!target) return;
    try {
      const state = await getState();
      if (!state.activeProfileId) throw new Error("Select a profile in the extension popup.");
      const payload = await buildAssistQuestionPayload(target);
      const answerText = getAnswerTextForSave(target);
      await bgMessage({
        type: "UPSERT_SAVED_ANSWER",
        profileId: state.activeProfileId,
        answerText,
        labelSnapshot: payload.labelSnapshot,
        source: payload.source,
        hostname: payload.hostname,
        externalFieldId: payload.externalFieldId,
        questionKey: payload.questionKey,
      });
      void bgMessage({
        type: "SEND_TELEMETRY",
        eventType: "saved_answer_upserted",
        data: { questionKey: payload.questionKey.slice(0, 120) },
      }).catch(() => {});
      if (statusEl) statusEl.textContent = "Saved.";
      await refreshStatus();
    } catch (e) {
      if (statusEl) statusEl.textContent = e instanceof Error ? e.message : "Save failed";
    }
  }

  async function onAi(): Promise<void> {
    if (!target) return;
    try {
      const state = await getState();
      if (!state.activeProfileId) throw new Error("Select a profile in the extension popup.");
      const payload = await buildAssistQuestionPayload(target);
      const fieldExcerpt = collectFieldExcerpt(target, 2800);
      const page = collectPageExcerpt(6000);
      const maxChars = inferAiDraftMaxChars(payload.labelSnapshot, target);
      await bgMessage({
        type: "AI_DRAFT_FOCUSED_FIELD",
        profileId: state.activeProfileId,
        intent: "open_question",
        fieldHint: payload.labelSnapshot,
        fieldExcerpt,
        pageTitle: page.title,
        pageUrl: page.url,
        pageExcerpt: page.excerpt,
        ...(maxChars != null ? { maxChars } : {}),
      });
      void bgMessage({
        type: "SEND_TELEMETRY",
        eventType: "field_ai_draft",
        data: { questionKey: payload.questionKey.slice(0, 120) },
      }).catch(() => {});
      closePanel();
    } catch (e) {
      if (statusEl) statusEl.textContent = e instanceof Error ? e.message : "AI draft failed";
    }
  }

  async function onFocusIn(ev: FocusEvent): Promise<void> {
    if (!isContextAlive()) return;
    const el = ev.target;
    if (!(el instanceof Element) || !isAssistEligible(el)) return;
    try {
      const state = await getState();
      if (state.fieldAssistEnabled === false) return;
    } catch {
      return;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    showChipFor(el);
  }

  function onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (next && root?.contains(next)) return;
    if (panelOpen) return;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (panelOpen) return;
      const ae = document.activeElement;
      if (ae === target || (ae && root?.contains(ae))) return;
      hideAll();
    }, 180);
  }

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener("scroll", schedulePosition, true);
  window.addEventListener("resize", schedulePosition);
}

