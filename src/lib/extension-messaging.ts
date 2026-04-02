/**
 * MV3 service workers can be inactive when a content script or popup first
 * calls `runtime.sendMessage`; Chrome may report no receiver until the worker
 * spins up. Retrying a few times clears that race in practice.
 */
import { isExtensionContextInvalidatedError } from "./extension-context.js";

function isTransientReceiverError(message: string | undefined): boolean {
  if (!message) return false;
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

export async function sendExtensionMessage<T>(payload: unknown): Promise<T> {
  const maxAttempts = 5;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await new Promise<
      { ok: true; response: T } | { ok: false; error: Error }
    >((resolve) => {
      chrome.runtime.sendMessage(payload, (response: T) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: new Error(err.message) });
          return;
        }
        resolve({ ok: true, response: response as T });
      });
    });

    if (result.ok) {
      return result.response;
    }

    lastError = result.error;
    if (isExtensionContextInvalidatedError(result.error)) {
      throw result.error;
    }
    if (isTransientReceiverError(result.error.message) && attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      continue;
    }

    throw result.error;
  }

  throw lastError ?? new Error("Extension messaging failed");
}
