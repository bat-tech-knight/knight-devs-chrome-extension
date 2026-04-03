import { autofillLog, describeField } from "./autofill-log.js";

/**
 * React keeps an internal _valueTracker on controlled inputs. If the tracker's
 * cached value matches the new value, React swallows the "input" event.
 * Resetting it before writing forces React to see a change.
 */
function resetReactValueTracker(el: HTMLInputElement | HTMLTextAreaElement): void {
  const tracker = (el as unknown as Record<string, { setValue?: (v: string) => void }>)
    ._valueTracker;
  if (tracker?.setValue) {
    tracker.setValue(el.value);
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  resetReactValueTracker(el);

  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInputLikeEvents(el: HTMLInputElement | HTMLTextAreaElement): void {
  try {
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
        data: el.value,
      })
    );
  } catch {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Fill a text input / textarea in a way that React / Remix controlled inputs pick up.
 */
export function fillTextInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  if (!value.trim()) return false;

  autofillLog("fillTextInput: start", {
    ...describeField(input),
    valueLength: value.length,
  });

  input.focus();
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

  setNativeValue(input, value);

  dispatchInputLikeEvents(input);

  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

  autofillLog("fillTextInput: done (events dispatched)", describeField(input));
  return true;
}

/**
 * Pick a <select> option from saved answer text (matches option label or value, case-insensitive).
 */
export function fillSelectBySavedAnswer(select: HTMLSelectElement, answerText: string): boolean {
  if (select.disabled || select.multiple) return false;
  const trimmed = answerText.trim();
  if (!trimmed) return false;

  autofillLog("fillSelectBySavedAnswer: start", {
    id: select.id || null,
    name: select.name || null,
    valueLength: trimmed.length,
  });

  const vl = trimmed.toLowerCase();

  for (const opt of Array.from(select.options)) {
    if (!opt.value) continue;
    const optText = (opt.textContent || "").trim().toLowerCase();
    const optVal = (opt.value || "").trim().toLowerCase();
    if (optVal === vl || optText === vl || optText.includes(vl) || vl.includes(optText)) {
      select.focus();
      select.value = opt.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      autofillLog("fillSelectBySavedAnswer: matched option", {
        optionValue: opt.value.slice(0, 80),
      });
      return true;
    }
  }

  for (const opt of Array.from(select.options)) {
    if (opt.value === trimmed) {
      select.focus();
      select.value = opt.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  autofillLog("fillSelectBySavedAnswer: no matching option", { id: select.id || null });
  return false;
}

export async function tryFillBySelectors(selectors: string[], value?: string): Promise<boolean> {
  if (!value) {
    autofillLog("tryFillBySelectors: skip (empty value)", { selectors });
    return false;
  }
  autofillLog("tryFillBySelectors: start", {
    selectors,
    valueLength: value.length,
  });
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) {
      autofillLog("tryFillBySelectors: no node", { selector });
      continue;
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      autofillLog("tryFillBySelectors: matched", { selector, ...describeField(node) });
      if (node instanceof HTMLInputElement && node.getAttribute("role") === "combobox") {
        return tryFillReactSelect(node, value, value);
      }
      return fillTextInput(node, value);
    }
    autofillLog("tryFillBySelectors: node not text control", {
      selector,
      nodeName: node.nodeName,
    });
  }
  autofillLog("tryFillBySelectors: failed (no matching input/textarea)", { selectors });
  return false;
}

function labelMatches(label: Element, lowerTexts: string[]): boolean {
  const text = (label.textContent || "").trim().toLowerCase().replace(/\s*\*\s*$/, "");
  return lowerTexts.some((lt) => text === lt || text.startsWith(lt) || text.includes(lt));
}

/**
 * Find an input/textarea whose visible `<label>` text matches one of the given strings.
 */
export function findFieldByLabel(
  root: Element | Document,
  labelTexts: string[]
): HTMLInputElement | HTMLTextAreaElement | null {
  const labels = Array.from(root.querySelectorAll("label"));
  const lowerTexts = labelTexts.map((t) => t.toLowerCase());

  for (const label of labels) {
    if (!labelMatches(label, lowerTexts)) continue;

    if (label.htmlFor) {
      const target = root.querySelector(`#${CSS.escape(label.htmlFor)}`);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
    }

    const nested =
      label.querySelector("input[role='combobox']") ||
      label.querySelector("input.select__input:not([type='hidden'])") ||
      label.querySelector("input:not([type='hidden'])") ||
      label.querySelector("textarea");
    if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) return nested;

    const wrapper = label.closest(".field-wrapper, .input-wrapper, .text-input-wrapper");
    if (wrapper) {
      const child =
        wrapper.querySelector("input[role='combobox']") ||
        wrapper.querySelector("input.select__input:not([type='hidden'])") ||
        wrapper.querySelector("input.input:not([type='hidden'])") ||
        wrapper.querySelector("textarea.input");
      if (child instanceof HTMLInputElement || child instanceof HTMLTextAreaElement) return child;
    }

    const next = label.nextElementSibling;
    if (next) {
      const child =
        next.querySelector("input[role='combobox']") ||
        next.querySelector("input.select__input:not([type='hidden'])") ||
        next.querySelector("input:not([type='hidden'])") ||
        next.querySelector("textarea");
      if (child instanceof HTMLInputElement || child instanceof HTMLTextAreaElement) return child;
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) return next;
    }
  }
  return null;
}

export async function tryFillByLabel(
  root: Element | Document,
  labelTexts: string[],
  value?: string
): Promise<boolean> {
  if (!value?.trim()) {
    autofillLog("tryFillByLabel: skip (empty value)", { labelTexts });
    return false;
  }
  autofillLog("tryFillByLabel: start", { labelTexts, valueLength: value.length });
  const field = findFieldByLabel(root, labelTexts);
  if (!field) {
    autofillLog("tryFillByLabel: no field for labels", { labelTexts });
    return false;
  }
  autofillLog("tryFillByLabel: found field", { labelTexts, ...describeField(field) });
  if (field instanceof HTMLInputElement && field.getAttribute("role") === "combobox") {
    return tryFillReactSelect(field, value, value);
  }
  return fillTextInput(field, value);
}

/**
 * React-Select combobox next to a label (Greenhouse / Remix). Label `for` often points at the combobox input id.
 */
export function findComboboxInputByLabel(
  root: Element | Document,
  labelSubstrings: string[]
): HTMLInputElement | null {
  const lower = labelSubstrings.map((s) => s.toLowerCase());
  const labels = Array.from(root.querySelectorAll("label"));

  for (const label of labels) {
    if (!labelMatches(label, lower)) continue;

    if (label.htmlFor) {
      const target = root.querySelector(`#${CSS.escape(label.htmlFor)}`);
      if (target instanceof HTMLInputElement && target.getAttribute("role") === "combobox") return target;
    }

    const wrap = label.closest(".field-wrapper") ?? label.closest(".select") ?? label.parentElement;
    if (wrap) {
      const cb = wrap.querySelector(
        "input.select__input[role='combobox'], input[role='combobox']"
      );
      if (cb instanceof HTMLInputElement) return cb;
    }
  }
  return null;
}

/**
 * Fill a native <select> by label text.
 */
export function tryFillSelect(
  root: Element | Document,
  labelTexts: string[],
  value?: string
): boolean {
  if (!value?.trim()) {
    autofillLog("tryFillSelect: skip (empty value)", { labelTexts });
    return false;
  }
  const vl = value.trim().toLowerCase();

  autofillLog("tryFillSelect: start", { labelTexts, value: vl });

  const labels = Array.from(root.querySelectorAll("label"));
  const lowerTexts = labelTexts.map((t) => t.toLowerCase());

  for (const label of labels) {
    if (!labelMatches(label, lowerTexts)) continue;

    let select: HTMLSelectElement | null = null;
    if (label.htmlFor) {
      const target = root.querySelector(`#${CSS.escape(label.htmlFor)}`);
      if (target instanceof HTMLSelectElement) select = target;
    }
    if (!select) {
      const next = label.nextElementSibling;
      if (next instanceof HTMLSelectElement) select = next;
      if (!select && next) {
        const child = next.querySelector("select");
        if (child instanceof HTMLSelectElement) select = child;
      }
    }
    if (!select || select.disabled) continue;

    for (const opt of Array.from(select.options)) {
      const optText = (opt.textContent || "").trim().toLowerCase();
      const optVal = (opt.value || "").trim().toLowerCase();
      if (!opt.value) continue;
      if (optVal === vl || optText === vl || optText.includes(vl) || vl.includes(optText)) {
        select.value = opt.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        autofillLog("tryFillSelect: selected option", {
          labelTexts,
          optionValue: opt.value,
          optionText: (opt.textContent || "").trim().slice(0, 80),
        });
        return true;
      }
    }
  }
  autofillLog("tryFillSelect: no matching <select>", { labelTexts, value: vl });
  return false;
}

function fillYesNoSelect(select: HTMLSelectElement, yes: boolean): boolean {
  if (select.disabled || select.multiple) return false;
  const tokens = yes ? ["yes", "true", "1", "y"] : ["no", "false", "0", "n"];

  for (const opt of Array.from(select.options)) {
    if (!opt.value) continue;
    const optText = (opt.textContent || "").trim().toLowerCase();
    const optVal = (opt.value || "").trim().toLowerCase();
    const hit = tokens.some(
      (w) => optVal === w || optText === w || optText.startsWith(`${w} `) || optText.startsWith(`${w},`)
    );
    if (hit) {
      select.focus();
      select.value = opt.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  return false;
}

function radioIntentMatches(r: HTMLInputElement, yes: boolean): boolean {
  const val = (r.value || "").trim().toLowerCase();
  if (yes) {
    if (["yes", "true", "1", "y"].includes(val)) return true;
  } else if (["no", "false", "0", "n"].includes(val)) {
    return true;
  }

  const doc = r.ownerDocument;
  const id = r.id?.trim();
  let labelText = "";
  if (id) {
    const lb = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    labelText = (lb?.textContent || "").trim().toLowerCase();
  }
  if (!labelText && r.parentElement?.tagName === "LABEL") {
    labelText = (r.parentElement.textContent || "").trim().toLowerCase();
  }
  if (yes) {
    return /\byes\b/.test(labelText);
  }
  return /\bno\b/.test(labelText);
}

function fillYesNoRadioGroup(radios: HTMLInputElement[], yes: boolean): boolean {
  for (const r of radios) {
    if (!radioIntentMatches(r, yes)) continue;
    r.focus();
    r.checked = true;
    r.dispatchEvent(new Event("input", { bubbles: true }));
    r.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      r.click();
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

/**
 * Fill saved Yes/No text for a group of radios sharing the same `name` (pass any member).
 */
export function fillRadioGroupBySavedAnswer(radios: HTMLInputElement[], answerText: string): boolean {
  const trimmed = answerText.trim().toLowerCase();
  if (!trimmed) return false;

  const wantYes = trimmed === "yes" || trimmed.startsWith("yes ");
  const wantNo = trimmed === "no" || trimmed.startsWith("no ");
  if (wantYes || wantNo) {
    return fillYesNoRadioGroup(radios, wantYes);
  }

  for (const r of radios) {
    if ((r.value || "").trim().toLowerCase() === trimmed) {
      r.focus();
      r.checked = true;
      r.dispatchEvent(new Event("input", { bubbles: true }));
      r.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        r.click();
      } catch {
        /* ignore */
      }
      return true;
    }
  }
  return false;
}

function tryFillYesNoNearQuestionEl(
  questionEl: Element,
  root: Element | Document,
  yes: boolean
): boolean {
  if (questionEl instanceof HTMLLabelElement && questionEl.htmlFor) {
    const target = root.querySelector(`#${CSS.escape(questionEl.htmlFor)}`);
    if (target instanceof HTMLSelectElement && fillYesNoSelect(target, yes)) return true;
  }

  const containers: Element[] = [];
  if (questionEl instanceof HTMLLegendElement) {
    const fs = questionEl.closest("fieldset");
    if (fs) containers.push(fs);
  }
  const wrap = questionEl.closest(
    ".field-wrapper, .form-group, .application-field, [class*='field'], [role='group']"
  );
  if (wrap) containers.push(wrap);
  if (questionEl.parentElement) containers.push(questionEl.parentElement);

  for (const container of containers) {
    if (!container) continue;
    const sel = container.querySelector("select:not([multiple]):not([disabled])");
    if (sel instanceof HTMLSelectElement && fillYesNoSelect(sel, yes)) return true;

    const radios = Array.from(
      container.querySelectorAll("input[type='radio']:not([disabled])")
    ) as HTMLInputElement[];
    if (radios.length && fillYesNoRadioGroup(radios, yes)) return true;
  }

  let sib: Element | null = questionEl.nextElementSibling;
  for (let i = 0; i < 5 && sib; i += 1, sib = sib.nextElementSibling) {
    if (sib instanceof HTMLSelectElement && !sib.disabled && fillYesNoSelect(sib, yes)) return true;
    const nested = sib.querySelector("select:not([multiple]):not([disabled])");
    if (nested instanceof HTMLSelectElement && fillYesNoSelect(nested, yes)) return true;
    const radios = Array.from(
      sib.querySelectorAll("input[type='radio']:not([disabled])")
    ) as HTMLInputElement[];
    if (radios.length && fillYesNoRadioGroup(radios, yes)) return true;
  }

  return false;
}

/**
 * Fill a Yes/No <select> or radio group tied to a question label/legend.
 */
export function tryFillYesNoByQuestionLabel(
  root: Element | Document,
  labelKeywords: string[],
  yes: boolean
): boolean {
  autofillLog("tryFillYesNoByQuestionLabel: start", { labelKeywords, yes });
  const lowerTexts = labelKeywords.map((t) => t.toLowerCase());
  const headings = Array.from(root.querySelectorAll("label, legend"));

  for (const el of headings) {
    if (!labelMatches(el, lowerTexts)) continue;
    if (tryFillYesNoNearQuestionEl(el, root, yes)) {
      autofillLog("tryFillYesNoByQuestionLabel: filled", { labelKeywords, yes });
      return true;
    }
  }

  autofillLog("tryFillYesNoByQuestionLabel: no match", { labelKeywords });
  return false;
}

function isElementVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent !== null) return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * React-Select menus may live in a portal or on `document.body`. Prefer the listbox that looks “open”
 * (has options, visible container or visible options) when several nodes stay in the DOM.
 */
function findOpenListbox(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = -1;
  for (const node of Array.from(document.querySelectorAll("[role='listbox']"))) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute("aria-hidden") === "true") continue;
    const options = collectListboxOptions(node);
    if (!options.length) continue;
    const lbVisible = isElementVisible(node);
    let visibleOpts = 0;
    for (const o of options) {
      if (isElementVisible(o)) visibleOpts += 1;
    }
    const score = visibleOpts * 20 + options.length + (lbVisible ? 80 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function listboxFromIdList(ids: string | null): HTMLElement | null {
  if (!ids?.trim()) return null;
  for (const raw of ids.trim().split(/\s+/)) {
    const id = raw.trim();
    if (!id) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.getAttribute("role") === "listbox" && el instanceof HTMLElement) return el;
    const inner = el.querySelector("[role='listbox']");
    if (inner instanceof HTMLElement) return inner;
  }
  return null;
}

/**
 * Resolve the menu for this combobox only. Global “best” listbox picks the wrong field when several
 * React-Selects exist (e.g. Country vs State).
 */
function findListboxForCombobox(combobox: HTMLInputElement): HTMLElement | null {
  let lb = listboxFromIdList(combobox.getAttribute("aria-controls"));
  if (lb) return lb;
  lb = listboxFromIdList(combobox.getAttribute("aria-owns"));
  if (lb) return lb;

  const ad = combobox.getAttribute("aria-activedescendant")?.trim();
  if (ad) {
    const opt = document.getElementById(ad);
    const host = opt?.closest("[role='listbox']");
    if (host instanceof HTMLElement) return host;
  }

  const controlEl = (combobox.closest(".select__control") ?? combobox) as HTMLElement;
  const cr = controlEl.getBoundingClientRect();
  if (cr.width < 2 || cr.height < 2) return findOpenListbox();

  let best: HTMLElement | null = null;
  let bestScore = -1;
  const cx = cr.left + cr.width / 2;

  for (const node of Array.from(document.querySelectorAll("[role='listbox']"))) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute("aria-hidden") === "true") continue;
    const options = collectListboxOptions(node);
    if (!options.length) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;

    const nx = r.left + r.width / 2;
    const horiz = Math.abs(nx - cx);
    const maxSlack = Math.max(cr.width, r.width) * 0.75 + 100;
    if (horiz > maxSlack) continue;

    const gapBelow = r.top - cr.bottom;
    const gapAbove = cr.top - r.bottom;
    const alignedBelow = gapBelow >= -12 && gapBelow < 480;
    const alignedAbove = gapAbove >= -12 && gapAbove < 420;
    if (!alignedBelow && !alignedAbove) continue;

    let visibleOpts = 0;
    for (const o of options) {
      if (isElementVisible(o)) visibleOpts += 1;
    }
    const vertDist = Math.min(
      Math.abs(r.top - cr.bottom),
      Math.abs(cr.top - r.bottom)
    );
    const score =
      6000 -
      Math.min(3500, vertDist * 4) -
      Math.min(2500, horiz * 3) +
      visibleOpts * 30 +
      options.length * 2;

    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }

  return best ?? findOpenListbox();
}

function normalizeMatchText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Higher score = better match between list option label and saved answer text. */
function scoreOptionAgainstDesired(optionLabel: string, desired: string): number {
  const t = normalizeMatchText(optionLabel);
  const w = normalizeMatchText(desired);
  if (!w || !t) return 0;
  if (t === w) return 10_000;
  if (t.startsWith(w) || w.startsWith(t)) return 8_200;
  if (t.includes(w)) return 6_200;
  if (w.includes(t)) {
    if (t.length < 4) return 0;
    return 4_200 + Math.min(800, t.length * 40);
  }
  const words = w.split(/\s+/).filter((x) => x.length > 1);
  if (words.length === 0) return 0;
  const hit = words.filter((word) => t.includes(word)).length;
  if (hit === words.length) return 4_000 + hit * 100;
  if (words.length >= 2 && hit >= Math.ceil(words.length * 0.55)) return 2_600 + hit * 130;
  return hit * 160;
}

function collectListboxOptions(listbox: Element): HTMLElement[] {
  return Array.from(listbox.querySelectorAll("[role='option']")) as HTMLElement[];
}

/**
 * Click the option that best matches saved text. Falls back to all options when none are “visible”
 * (virtualized menus). If desired is empty, clicks the first option (legacy autofill behavior).
 */
function clickBestMatchingOption(listbox: Element, desired?: string): boolean {
  const options = collectListboxOptions(listbox);
  if (!options.length) return false;

  let pool = options.filter(isElementVisible);
  if (!pool.length) pool = options;

  const desiredTrim = desired?.trim() ?? "";
  if (!desiredTrim) {
    const first = pool[0];
    if (first) {
      first.scrollIntoView({ block: "nearest", behavior: "instant" });
      first.click();
      return true;
    }
    return false;
  }

  const scored = pool.map((o) => {
    const label = (o.textContent || "").replace(/\s+/g, " ").trim();
    return { o, sc: scoreOptionAgainstDesired(label, desiredTrim) };
  });
  scored.sort((a, b) => b.sc - a.sc);

  const top = scored[0];
  const second = scored[1];
  const best = top?.o ?? null;
  const bestScore = top?.sc ?? 0;
  const secondScore = second?.sc ?? 0;

  const MIN_SCORE = 2_400;
  const ambiguous =
    secondScore >= 2_000 && bestScore - secondScore < Math.max(900, bestScore * 0.14);
  if (ambiguous && bestScore < 7_500) {
    return false;
  }

  if (best && bestScore >= MIN_SCORE) {
    best.scrollIntoView({ block: "nearest", behavior: "instant" });
    best.click();
    return true;
  }

  if (pool.length === 1 && pool[0]) {
    pool[0].scrollIntoView({ block: "nearest", behavior: "instant" });
    pool[0].click();
    return true;
  }

  return false;
}

/**
 * Synthetic `element.click()` often does not open React-Select’s menu (handlers listen for
 * pointer/mouse down on the control). Use real coordinates on the control surface.
 */
function openReactSelectMenuSurface(control: HTMLElement): void {
  const r = control.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const x = r.left + Math.min(r.width / 2, 80);
  const y = r.top + r.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: window,
  } as const;
  try {
    control.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...base,
        pointerId: 1,
        pointerType: "mouse",
        buttons: 1,
        button: 0,
      })
    );
  } catch {
    /* PointerEvent unsupported */
  }
  control.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
  control.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
  control.dispatchEvent(new MouseEvent("click", { ...base, button: 0, buttons: 0 }));
}

/**
 * React-Select keeps the real value in React state, not on the combobox input. Setting
 * `input.value` + events does not update that state, so the UI and submit payload usually ignore it.
 * When the page also renders a native `<select>` (often visually hidden) in the same field, we can set that directly — no menu.
 */
function tryFillComboboxViaNativeSelectMirror(
  combobox: HTMLInputElement,
  answerText: string
): boolean {
  const wrap =
    combobox.closest(".field-wrapper") ??
    combobox.closest(".application--question") ??
    combobox.closest(".application-field");
  if (!wrap) return false;

  for (const sel of Array.from(wrap.querySelectorAll("select"))) {
    if (!(sel instanceof HTMLSelectElement) || sel.multiple || sel.disabled) continue;
    if (fillSelectBySavedAnswer(sel, answerText)) {
      autofillLog("tryFillReactSelect: native <select> mirror", {
        comboboxId: combobox.id || null,
        selectId: sel.id || null,
      });
      return true;
    }
  }
  return false;
}

/**
 * Open React-Select, match saved label against menu options.
 * Fills saved answers reliably: open-menu-first (no over-filter), then short→long typed filters, scoring.
 */
export async function tryFillReactSelect(
  comboboxSelectorOrInput: string | HTMLInputElement,
  filterOrOptionText?: string,
  optionPreference?: string
): Promise<boolean> {
  const input =
    typeof comboboxSelectorOrInput === "string"
      ? document.querySelector(comboboxSelectorOrInput)
      : comboboxSelectorOrInput;
  if (!(input instanceof HTMLInputElement)) {
    autofillLog("tryFillReactSelect: abort (not an input)", {
      selector:
        typeof comboboxSelectorOrInput === "string" ? comboboxSelectorOrInput : "(element)",
    });
    return false;
  }
  if (input.getAttribute("role") !== "combobox") {
    autofillLog("tryFillReactSelect: abort (not role=combobox)", {
      id: input.id,
      role: input.getAttribute("role"),
    });
    return false;
  }

  const filter = filterOrOptionText?.trim() ?? "";
  const pref = optionPreference?.trim() ?? "";
  const matchLabel = pref || filter;
  if (!matchLabel) {
    autofillLog("tryFillReactSelect: abort (empty filter and preference)", { id: input.id });
    return false;
  }

  autofillLog("tryFillReactSelect: start", {
    id: input.id,
    matchLabelLength: matchLabel.length,
  });

  if (tryFillComboboxViaNativeSelectMirror(input, matchLabel)) {
    return true;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const control =
    input.closest(".select__control") ?? input.closest("[class*='select__control']");

  const clearInput = (): void => {
    resetReactValueTracker(input);
    if (setter) setter.call(input, "");
    else input.value = "";
    dispatchInputLikeEvents(input);
  };

  const pollAndPick = async (attempts: number, delayMs: number): Promise<boolean> => {
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((r) => setTimeout(r, delayMs));
      const listbox = findListboxForCombobox(input);
      if (listbox && clickBestMatchingOption(listbox, matchLabel)) {
        autofillLog("tryFillReactSelect: chose option", { id: input.id, attempt: i + 1 });
        return true;
      }
    }
    return false;
  };

  input.focus();
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

  // Phase A: empty filter + open — avoids React-Select hiding the right row when the full string is typed.
  clearInput();
  await new Promise((r) => setTimeout(r, 60));
  if (control instanceof HTMLElement) {
    openReactSelectMenuSurface(control);
  } else {
    openReactSelectMenuSurface(input);
  }
  await new Promise((r) => setTimeout(r, 30));
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
      bubbles: true,
      cancelable: true,
    })
  );
  if (await pollAndPick(22, 80)) return true;

  // Phase B: type progressively shorter → longer prefixes so async/filtered menus still surface a match.
  const prefixSet = new Set<string>([matchLabel]);
  for (const maxLen of [32, 22, 14, 8, 4]) {
    if (matchLabel.length > maxLen) {
      let slice = matchLabel.slice(0, maxLen);
      slice = slice.replace(/\s+\S*$/, "").trim();
      if (slice.length >= 2) prefixSet.add(slice);
    }
  }
  const prefixes = [...prefixSet].sort((a, b) => a.length - b.length);

  for (const prefix of prefixes) {
    clearInput();
    input.focus();
    resetReactValueTracker(input);
    if (setter) setter.call(input, prefix);
    else input.value = prefix;
    dispatchInputLikeEvents(input);
    autofillLog("tryFillReactSelect: typed prefix", {
      id: input.id,
      prefixLen: prefix.length,
    });
    if (await pollAndPick(16, 75)) return true;
  }

  // Phase C: keyboard open + pick
  clearInput();
  input.focus();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true })
  );
  if (await pollAndPick(10, 90)) return true;

  autofillLog("tryFillReactSelect: Enter fallback", { id: input.id });
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  return false;
}

/** Plain text/textarea, or React-Select combobox (opens menu and picks a matching option). */
export async function fillTextInputOrReactSelect(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<boolean> {
  if (!value.trim()) return false;
  if (input instanceof HTMLInputElement && input.getAttribute("role") === "combobox") {
    return tryFillReactSelect(input, value, value);
  }
  return fillTextInput(input, value);
}

export async function tryFillReactSelectByLabel(
  root: Element | Document,
  labelSubstrings: string[],
  filterText: string,
  optionPreference?: string
): Promise<boolean> {
  autofillLog("tryFillReactSelectByLabel: start", {
    labelSubstrings,
    filterLength: filterText?.length ?? 0,
  });
  const combobox = findComboboxInputByLabel(root, labelSubstrings);
  if (!combobox) {
    autofillLog("tryFillReactSelectByLabel: no combobox for labels", { labelSubstrings });
    return false;
  }
  autofillLog("tryFillReactSelectByLabel: combobox found", {
    labelSubstrings,
    id: combobox.id,
  });
  return tryFillReactSelect(combobox, filterText, optionPreference);
}

/**
 * Assign a File to a native file input (React/Greenhouse pick up change + input).
 */
export function assignFileToFileInput(input: HTMLInputElement, file: File): boolean {
  if (input.type !== "file" || input.disabled) {
    autofillLog("assignFileToFileInput: skip", { type: input.type, disabled: input.disabled });
    return false;
  }
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText" })
      );
    } catch {
      /* InputEvent unsupported */
    }
    autofillLog("assignFileToFileInput: assigned", {
      id: input.id || null,
      name: file.name,
      size: file.size,
    });
    return true;
  } catch (e) {
    autofillLog("assignFileToFileInput: error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export function clickSubmitButton(): boolean {
  const candidates = [
    "button[type='submit']",
    "input[type='submit']",
    "button[data-qa='btn-submit']",
  ];
  for (const selector of candidates) {
    const node = document.querySelector(selector);
    if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) {
      autofillLog("clickSubmitButton: clicking", { selector });
      node.click();
      return true;
    }
    autofillLog("clickSubmitButton: no node", { selector });
  }
  autofillLog("clickSubmitButton: no submit control found", { candidates });
  return false;
}
