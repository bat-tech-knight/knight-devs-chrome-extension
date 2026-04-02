/**
 * After reloading the extension in chrome://extensions, existing content scripts keep running
 * but `chrome.*` APIs throw — until the user refreshes the tab.
 */
export const EXTENSION_CONTEXT_INVALIDATED_HINT =
  "Extension was reloaded or updated — refresh this page to use Knight Devs Autofill again.";

export function isExtensionContextInvalidatedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /extension context invalidated/i.test(msg);
}

/**
 * Synchronous check — when `chrome.runtime.id` is `undefined` the context is dead
 * and every `chrome.*` call will throw "Extension context invalidated".
 */
export function isContextAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
