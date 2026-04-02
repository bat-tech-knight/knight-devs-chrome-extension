import {
  fetchCandidateRaw,
  fetchProfiles,
  fetchResumeFileForAutofill,
  fetchSavedAnswersList,
  lookupSavedAnswer,
  lookupSavedAnswerBuiltin,
  sendTelemetry,
  suggestFieldDraft,
  upsertSavedAnswer,
} from "./lib/api-client.js";
import {
  clearSession,
  getValidAccessToken,
  loadStoredSession,
  loginViaApi,
  logoutViaApi,
} from "./lib/extension-session.js";
import type { SiteBehavior } from "./lib/schema.js";
import { deriveSiteKey, getSiteBehavior, getState, saveState } from "./lib/storage.js";

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/**
 * Send a message to the content script in a tab, injecting it first if it
 * hasn't been loaded yet (e.g. the tab was open before the extension was
 * installed or reloaded).
 */
async function sendToContentScript<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      throw err;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  await new Promise((r) => setTimeout(r, 150));
  return await chrome.tabs.sendMessage(tabId, message);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "GET_POPUP_DATA") {
        const state = await getState();
        const tab = await getActiveTab();
        const siteKey = tab?.url ? deriveSiteKey(tab.url) : "unknown";

        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        const stored = await loadStoredSession();
        const userEmail = stored?.user?.email ?? null;

        let profiles: Awaited<ReturnType<typeof fetchProfiles>> = [];
        if (accessToken) {
          try {
            profiles = await fetchProfiles(state.apiBaseUrl, accessToken);
          } catch {
            profiles = [];
          }
        }

        sendResponse({
          ok: true,
          state,
          profiles,
          siteKey,
          siteBehavior: getSiteBehavior(state, siteKey),
          userEmail,
          isAuthenticated: Boolean(accessToken),
          fieldAssistEnabled: state.fieldAssistEnabled !== false,
          aiFillMissingFields: state.aiFillMissingFields === true,
        });
        return;
      }

      if (message?.type === "SET_AI_FILL_MISSING_FIELDS") {
        const next = await saveState({ aiFillMissingFields: Boolean(message.enabled) });
        sendResponse({ ok: true, state: next });
        return;
      }

      if (message?.type === "SET_FIELD_ASSIST_ENABLED") {
        const next = await saveState({ fieldAssistEnabled: Boolean(message.enabled) });
        sendResponse({ ok: true, state: next });
        return;
      }

      if (message?.type === "FETCH_SAVED_ANSWERS_LIST") {
        const state = await getState();
        const profileId = message.profileId as string;
        if (!profileId) throw new Error("profileId is required");
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const rows = await fetchSavedAnswersList(state.apiBaseUrl, accessToken, profileId);
        sendResponse({ ok: true, data: rows });
        return;
      }

      if (message?.type === "LOOKUP_SAVED_ANSWER") {
        const state = await getState();
        const profileId = message.profileId as string;
        const questionKey = message.questionKey as string;
        if (!profileId || !questionKey) throw new Error("profileId and questionKey are required");
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        let row = await lookupSavedAnswer(state.apiBaseUrl, accessToken, profileId, questionKey);
        const bk =
          typeof message.builtinKey === "string" && message.builtinKey.trim()
            ? message.builtinKey.trim()
            : "";
        if ((!row || !String(row.answer_text ?? "").trim()) && bk) {
          row = await lookupSavedAnswerBuiltin(state.apiBaseUrl, accessToken, profileId, bk);
        }
        sendResponse({ ok: true, data: row });
        return;
      }

      if (message?.type === "UPSERT_SAVED_ANSWER") {
        const state = await getState();
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const profileId = message.profileId as string;
        if (!profileId) throw new Error("profileId is required");
        const row = await upsertSavedAnswer(state.apiBaseUrl, accessToken, {
          profileId,
          answerText: String(message.answerText ?? ""),
          labelSnapshot: String(message.labelSnapshot ?? ""),
          source: String(message.source ?? "generic"),
          hostname: String(message.hostname ?? "unknown"),
          externalFieldId:
            message.externalFieldId === null || message.externalFieldId === undefined
              ? null
              : String(message.externalFieldId),
          questionKey: typeof message.questionKey === "string" ? message.questionKey : undefined,
        });
        sendResponse({ ok: true, data: row });
        return;
      }

      if (message?.type === "LOGIN_EMAIL_PASSWORD") {
        const state = await getState();
        const email = String(message.email ?? "");
        const password = String(message.password ?? "");
        await loginViaApi(state.apiBaseUrl, email, password);
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "LOGOUT") {
        const state = await getState();
        const session = await loadStoredSession();
        if (session?.access_token) {
          await logoutViaApi(state.apiBaseUrl, session.access_token);
        }
        await clearSession();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "SET_ACTIVE_PROFILE") {
        const state = await saveState({ activeProfileId: message.profileId as string });
        sendResponse({ ok: true, state });
        return;
      }

      if (message?.type === "UPDATE_SITE_BEHAVIOR") {
        const tab = await getActiveTab();
        const siteKey = tab?.url ? deriveSiteKey(tab.url) : "unknown";
        const state = await getState();
        const merged: SiteBehavior = {
          ...getSiteBehavior(state, siteKey),
          ...(message.behavior as Partial<SiteBehavior>),
        };
        const next = await saveState({
          siteBehavior: {
            [siteKey]: merged,
          },
        });
        sendResponse({ ok: true, state: next, siteKey });
        return;
      }

      if (message?.type === "FETCH_CANDIDATE") {
        const state = await getState();
        const profileId = message.profileId as string;
        if (!profileId) throw new Error("profileId is required");
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const raw = await fetchCandidateRaw(state.apiBaseUrl, accessToken, profileId);
        sendResponse({ ok: true, data: raw });
        return;
      }

      if (message?.type === "FETCH_RESUME_FOR_AUTOFILL") {
        const state = await getState();
        const profileId = String(message.profileId ?? "").trim();
        if (!profileId) throw new Error("profileId is required");
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const { base64, mimeType, filename } = await fetchResumeFileForAutofill(
          state.apiBaseUrl,
          accessToken,
          profileId
        );
        sendResponse({ ok: true, base64, mimeType, filename });
        return;
      }

      if (message?.type === "SEND_TELEMETRY") {
        const state = await getState();
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) {
          sendResponse({ ok: true, skipped: true });
          return;
        }
        await sendTelemetry(
          state.apiBaseUrl,
          accessToken,
          message.eventType as string,
          (message.data as Record<string, unknown>) ?? {}
        );
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "RUN_AUTOFILL_ON_ACTIVE_TAB") {
        const tab = await getActiveTab();
        if (!tab?.id) throw new Error("No active tab found");
        await sendToContentScript(tab.id, { type: "RUN_AUTOFILL" });
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "SUGGEST_FIELD_FOR_AUTOFILL") {
        const state = await getState();
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const profileId = (message.profileId as string) || state.activeProfileId;
        if (!profileId) throw new Error("Select a profile first");

        const text = await suggestFieldDraft(state.apiBaseUrl, accessToken, {
          profileId,
          intent: (message.intent as "open_question" | "cover_letter" | "why_role") ?? "open_question",
          pageTitle: String(message.pageTitle ?? ""),
          pageUrl: String(message.pageUrl ?? ""),
          pageExcerpt: String(message.pageExcerpt ?? ""),
          fieldExcerpt: typeof message.fieldExcerpt === "string" ? message.fieldExcerpt : undefined,
          fieldHint: typeof message.fieldHint === "string" ? message.fieldHint : undefined,
          maxChars: typeof message.maxChars === "number" ? message.maxChars : undefined,
        });

        sendResponse({ ok: true, text });
        return;
      }

      if (message?.type === "AI_DRAFT_FOCUSED_FIELD") {
        const tabId = sender.tab?.id;
        if (!tabId) throw new Error("No active tab for AI draft");

        const state = await getState();
        const accessToken = await getValidAccessToken(state.apiBaseUrl);
        if (!accessToken) throw new Error("Not signed in");
        const profileId = (message.profileId as string) || state.activeProfileId;
        if (!profileId) throw new Error("Select a profile first");

        const text = await suggestFieldDraft(state.apiBaseUrl, accessToken, {
          profileId,
          intent: (message.intent as "open_question" | "cover_letter" | "why_role") ?? "open_question",
          pageTitle: String(message.pageTitle ?? ""),
          pageUrl: String(message.pageUrl ?? ""),
          pageExcerpt: String(message.pageExcerpt ?? ""),
          fieldExcerpt: typeof message.fieldExcerpt === "string" ? message.fieldExcerpt : undefined,
          fieldHint: typeof message.fieldHint === "string" ? message.fieldHint : undefined,
          maxChars: typeof message.maxChars === "number" ? message.maxChars : undefined,
        });

        const applyRes = (await sendToContentScript(tabId, {
          type: "APPLY_AI_SUGGESTION",
          text,
        })) as { ok?: boolean; applied?: boolean };

        if (!applyRes?.applied) {
          throw new Error(
            "Could not paste AI text — focus the field and try again, or use a standard text input/textarea."
          );
        }

        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unsupported message type" });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  })();

  return true;
});
