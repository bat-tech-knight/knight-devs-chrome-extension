import {
  EXTENSION_CONTEXT_INVALIDATED_HINT,
  isContextAlive,
  isExtensionContextInvalidatedError,
} from "../lib/extension-context.js";
import { sendExtensionMessage } from "../lib/extension-messaging.js";
import { normalizeCandidate } from "../lib/schema.js";
import { getState, getSiteBehavior } from "../lib/storage.js";
import type { SavedApplicationAnswerRow } from "../lib/api-client.js";
import { applyAiSuggestion, collectPageExcerpt } from "./ai-fill.js";
import { clickSubmitButton } from "./fill-engine.js";
import { injectAutofillButton } from "./autofill-button.js";
import { autofillLog, candidateLogShape } from "./autofill-log.js";
import { initFieldAssist } from "./field-assist.js";
import { applyAiGapFill } from "./ai-gap-fill.js";
import { applyMatchingSavedAnswers } from "./saved-answers-merge.js";
import { getAdapterForUrl } from "./site-adapters.js";

function requireAliveContext(): void {
  if (!isContextAlive()) {
    throw new Error("Extension context invalidated.");
  }
}

async function sendMessage<T>(payload: unknown): Promise<T> {
  requireAliveContext();
  const response = await sendExtensionMessage<T & { ok?: boolean; error?: string }>(payload);
  if (!response || (response as { ok?: boolean }).ok === false) {
    throw new Error((response as { error?: string })?.error ?? "Unknown error");
  }
  return response as T;
}

async function fetchCandidateRemote(profileId: string): Promise<Record<string, unknown>> {
  const response = await sendMessage<{ ok: true; data: Record<string, unknown> }>({
    type: "FETCH_CANDIDATE",
    profileId,
  });
  return response.data;
}

async function sendTelemetryRemote(eventType: string, data: Record<string, unknown>): Promise<void> {
  try {
    await sendMessage({ type: "SEND_TELEMETRY", eventType, data });
  } catch {
    /* non-critical */
  }
}

async function runAutofill(): Promise<void> {
  requireAliveContext();

  autofillLog("runAutofill: start", { href: window.location.href });

  const adapter = getAdapterForUrl(window.location.href);
  if (!adapter) {
    autofillLog("runAutofill: abort — no site adapter for this URL", {
      href: window.location.href,
    });
    return;
  }
  autofillLog("runAutofill: adapter", { site: adapter.site });

  const state = await getState();
  autofillLog("runAutofill: storage state", {
    activeProfileId: state.activeProfileId,
    apiBaseUrl: state.apiBaseUrl,
  });

  if (!state.activeProfileId) {
    console.warn("Knight Devs Autofill: active profile is not selected.");
    autofillLog("runAutofill: abort — no active profile selected in extension popup", {});
    return;
  }

  const siteBehavior = getSiteBehavior(state, adapter.site);
  autofillLog("runAutofill: site behavior", { ...siteBehavior, site: adapter.site });

  try {
    autofillLog("runAutofill: fetching candidate from API", { profileId: state.activeProfileId });
    const raw = await fetchCandidateRemote(state.activeProfileId);
    autofillLog("runAutofill: candidate raw keys", {
      keys: Object.keys(raw).sort(),
    });

    const candidate = normalizeCandidate(raw, state.activeProfileId);
    autofillLog("runAutofill: normalized candidate (presence only)", candidateLogShape(candidate));

    let savedRows: SavedApplicationAnswerRow[] = [];
    try {
      const listRes = await sendMessage<{ ok: true; data: SavedApplicationAnswerRow[] }>({
        type: "FETCH_SAVED_ANSWERS_LIST",
        profileId: state.activeProfileId,
      });
      savedRows = Array.isArray(listRes.data) ? listRes.data : [];
      autofillLog("runAutofill: saved answers loaded", { count: savedRows.length });
    } catch (e) {
      autofillLog("runAutofill: saved answers list skipped", {
        message: e instanceof Error ? e.message : String(e),
      });
    }

    autofillLog("runAutofill: calling adapter.fill", { site: adapter.site });
    const report = await adapter.fill(candidate);
    autofillLog("runAutofill: adapter.fill returned", {
      site: report.site,
      filledFields: report.filledFields,
      missingFields: report.missingFields,
      submitted: report.submitted,
    });

    if (savedRows.length > 0) {
      try {
        const merged = await applyMatchingSavedAnswers(savedRows, adapter.site);
        report.filledFields += merged;
        autofillLog("runAutofill: saved answers merged into form", { merged });
      } catch (e) {
        autofillLog("runAutofill: saved answers merge failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (state.aiFillMissingFields) {
      try {
        const aiFilled = await applyAiGapFill(adapter.site, state.activeProfileId, savedRows);
        if (aiFilled > 0) {
          report.filledFields += aiFilled;
          autofillLog("runAutofill: AI gap fill applied", { aiFilled });
        }
      } catch (e) {
        autofillLog("runAutofill: AI gap fill failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (siteBehavior.submitMode === "fill_and_submit") {
      const canAutoSubmit = report.missingFields.length === 0;
      const needsConfirm = siteBehavior.triggerMode === "manual";
      autofillLog("runAutofill: submit mode check", {
        submitMode: siteBehavior.submitMode,
        canAutoSubmit,
        needsConfirm,
      });
      if (canAutoSubmit && (!needsConfirm || window.confirm("Submit this application now?"))) {
        report.submitted = clickSubmitButton();
        autofillLog("runAutofill: submit attempted", { submitted: report.submitted });
      } else {
        autofillLog("runAutofill: submit skipped", { canAutoSubmit, needsConfirm });
      }
    } else {
      autofillLog("runAutofill: submit not enabled (fill only)", {});
    }

    await sendTelemetryRemote("autofill_success", {
      site: report.site,
      filledFields: report.filledFields,
      submitted: report.submitted,
      missingFieldsCount: report.missingFields.length,
      profileId: state.activeProfileId,
    });
    autofillLog("runAutofill: complete (success path)", {});
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      console.warn("Knight Devs Autofill:", EXTENSION_CONTEXT_INVALIDATED_HINT);
      autofillLog("runAutofill: extension context invalidated", {});
      return;
    }
    autofillLog("runAutofill: error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await sendTelemetryRemote("autofill_error", {
      site: adapter.site,
      profileId: state.activeProfileId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RUN_AUTOFILL") {
    autofillLog("onMessage: RUN_AUTOFILL", {});
    void runAutofill()
      .then(() => sendResponse({ ok: true }))
      .catch(() => {
        try {
          sendResponse({ ok: false, error: EXTENSION_CONTEXT_INVALIDATED_HINT });
        } catch {
          /* channel dead */
        }
      });
    return true;
  }
  if (message?.type === "COLLECT_PAGE_EXCERPT") {
    const maxChars = typeof message.maxChars === "number" ? message.maxChars : 8000;
    try {
      sendResponse({ ok: true, ...collectPageExcerpt(maxChars) });
    } catch {
      sendResponse({ ok: false, error: "excerpt_failed" });
    }
    return true;
  }
  if (message?.type === "APPLY_AI_SUGGESTION") {
    const text = String(message.text ?? "");
    void applyAiSuggestion(text).then(
      (applied) => {
        try {
          sendResponse({ ok: true, applied });
        } catch {
          /* channel closed */
        }
      },
      () => {
        try {
          sendResponse({ ok: true, applied: false });
        } catch {
          /* channel closed */
        }
      }
    );
    return true;
  }
  return false;
});

void (async () => {
  if (!isContextAlive()) return;

  try {
    const adapter = getAdapterForUrl(window.location.href);
    if (!adapter) return;

    const state = await getState();
    const behavior = getSiteBehavior(state, adapter.site);

    injectAutofillButton(runAutofill);

    try {
      initFieldAssist();
    } catch (e) {
      if (!isExtensionContextInvalidatedError(e)) {
        autofillLog("init: field assist failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (behavior.triggerMode === "auto_on_load") {
      autofillLog("init: triggerMode is auto_on_load — running autofill", { site: adapter.site });
      await runAutofill();
    } else {
      autofillLog("init: triggerMode is manual — waiting for button or popup", {
        site: adapter.site,
      });
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      console.warn("Knight Devs Autofill:", EXTENSION_CONTEXT_INVALIDATED_HINT);
    }
  }
})();
