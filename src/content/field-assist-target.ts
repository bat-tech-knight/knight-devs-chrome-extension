/** Avoid circular imports between field-assist and ai-fill. */

export type FieldAssistTargetEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

let pinned: FieldAssistTargetEl | null = null;

export function setFieldAssistTarget(el: FieldAssistTargetEl | null): void {
  pinned = el;
}

export function getFieldAssistTarget(): FieldAssistTargetEl | null {
  return pinned;
}
