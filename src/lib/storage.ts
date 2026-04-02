import { DEFAULT_SITE_BEHAVIOR, type ExtensionState, type SiteBehavior } from "./schema.js";
import { EXTENSION_API_BASE_URL } from "./extension-api-base.const.js";

const KEY = "knightDevsAutofillState";
const DEFAULT_BASE_URL = EXTENSION_API_BASE_URL;

const DEFAULT_STATE: ExtensionState = {
  activeProfileId: null,
  apiBaseUrl: DEFAULT_BASE_URL,
  siteBehavior: {},
  fieldAssistEnabled: true,
  aiFillMissingFields: false,
};

export async function getState(): Promise<ExtensionState> {
  const stored = await chrome.storage.sync.get(KEY);
  const value = stored[KEY] as
    | Partial<
        Pick<
          ExtensionState,
          "activeProfileId" | "siteBehavior" | "fieldAssistEnabled" | "aiFillMissingFields"
        >
      >
    | undefined;

  return {
    activeProfileId: value?.activeProfileId ?? DEFAULT_STATE.activeProfileId,
    apiBaseUrl: DEFAULT_BASE_URL,
    siteBehavior: value?.siteBehavior ?? {},
    fieldAssistEnabled:
      value?.fieldAssistEnabled !== undefined ? value.fieldAssistEnabled : DEFAULT_STATE.fieldAssistEnabled,
    aiFillMissingFields: value?.aiFillMissingFields === true,
  };
}

export async function saveState(partial: Partial<ExtensionState>): Promise<ExtensionState> {
  const current = await getState();
  const next: ExtensionState = {
    ...current,
    ...partial,
    apiBaseUrl: DEFAULT_BASE_URL,
    siteBehavior: {
      ...current.siteBehavior,
      ...(partial.siteBehavior ?? {}),
    },
  };
  await chrome.storage.sync.set({
    [KEY]: {
      activeProfileId: next.activeProfileId,
      siteBehavior: next.siteBehavior,
      fieldAssistEnabled: next.fieldAssistEnabled,
      aiFillMissingFields: next.aiFillMissingFields === true,
    },
  });
  return next;
}

export function deriveSiteKey(url: string): string {
  const host = new URL(url).hostname;
  if (host.includes("greenhouse")) return "greenhouse";
  if (host.includes("lever")) return "lever";
  return host;
}

export function getSiteBehavior(state: ExtensionState, siteKey: string): SiteBehavior {
  return state.siteBehavior[siteKey] ?? DEFAULT_SITE_BEHAVIOR;
}
