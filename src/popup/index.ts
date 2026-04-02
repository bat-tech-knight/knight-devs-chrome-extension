import { sendExtensionMessage } from "../lib/extension-messaging.js";
import type { SiteBehavior } from "../lib/schema.js";
import { renderProfileOptions } from "./profile-selector.js";

interface PopupResponse {
  ok: boolean;
  error?: string;
  state: { activeProfileId: string | null };
  profiles: Array<{ id: string; displayName: string }>;
  siteBehavior: SiteBehavior;
  siteKey: string;
  userEmail: string | null;
  isAuthenticated: boolean;
  fieldAssistEnabled: boolean;
  aiFillMissingFields: boolean;
}

async function message<T>(payload: unknown): Promise<T> {
  const response = await sendExtensionMessage<T & { ok?: boolean; error?: string }>(payload);
  if (!response || response.ok === false) {
    throw new Error(response?.error ?? "Unknown extension error");
  }
  return response as T;
}

async function loadPopup(): Promise<PopupResponse> {
  return message<PopupResponse>({ type: "GET_POPUP_DATA" });
}

function showPage(which: "signin" | "main"): void {
  const signin = document.getElementById("pageSignin") as HTMLDivElement;
  const main = document.getElementById("pageMain") as HTMLDivElement;
  signin.classList.toggle("hidden", which !== "signin");
  main.classList.toggle("hidden", which !== "main");
}

function setSigninError(el: HTMLDivElement, text: string | null): void {
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function applyMainData(data: PopupResponse): void {
  const profileSelect = document.getElementById("profileSelect") as HTMLSelectElement;
  const triggerMode = document.getElementById("triggerMode") as HTMLSelectElement;
  const submitMode = document.getElementById("submitMode") as HTMLSelectElement;
  const fieldAssistEnabled = document.getElementById("fieldAssistEnabled") as HTMLInputElement;
  const aiFillMissingFields = document.getElementById("aiFillMissingFields") as HTMLInputElement;
  const userInfo = document.getElementById("userInfo") as HTMLDivElement;
  const status = document.getElementById("status") as HTMLDivElement;

  renderProfileOptions(profileSelect, data.profiles, data.state.activeProfileId);
  triggerMode.value = data.siteBehavior.triggerMode;
  submitMode.value = data.siteBehavior.submitMode;
  fieldAssistEnabled.checked = data.fieldAssistEnabled !== false;
  aiFillMissingFields.checked = data.aiFillMissingFields === true;
  userInfo.textContent = data.userEmail ? `Signed in as ${data.userEmail}` : "";
  status.textContent = `Site: ${data.siteKey}`;
}

async function init(): Promise<void> {
  const emailInput = document.getElementById("emailInput") as HTMLInputElement;
  const passwordInput = document.getElementById("passwordInput") as HTMLInputElement;
  const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
  const signinError = document.getElementById("signinError") as HTMLDivElement;
  const signinStatus = document.getElementById("signinStatus") as HTMLDivElement;

  const profileSelect = document.getElementById("profileSelect") as HTMLSelectElement;
  const triggerMode = document.getElementById("triggerMode") as HTMLSelectElement;
  const submitMode = document.getElementById("submitMode") as HTMLSelectElement;
  const fieldAssistEnabled = document.getElementById("fieldAssistEnabled") as HTMLInputElement;
  const aiFillMissingFields = document.getElementById("aiFillMissingFields") as HTMLInputElement;
  const fillNow = document.getElementById("fillNow") as HTMLButtonElement;
  const status = document.getElementById("status") as HTMLDivElement;
  const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement;

  const refresh = async (): Promise<PopupResponse> => {
    const data = await loadPopup();

    if (data.isAuthenticated) {
      applyMainData(data);
      showPage("main");
      setSigninError(signinError, null);
      signinStatus.textContent = "";
    } else {
      showPage("signin");
      setSigninError(signinError, null);
    }
    return data;
  };

  try {
    await refresh();
  } catch (e) {
    showPage("signin");
    setSigninError(
      signinError,
      e instanceof Error ? e.message : "Could not talk to the extension background."
    );
  }

  loginBtn.addEventListener("click", async () => {
    setSigninError(signinError, null);
    signinStatus.textContent = "Signing in…";
    loginBtn.disabled = true;
    try {
      await message({
        type: "LOGIN_EMAIL_PASSWORD",
        email: emailInput.value,
        password: passwordInput.value,
      });
      passwordInput.value = "";
      signinStatus.textContent = "Signed in.";
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      setSigninError(signinError, msg);
      signinStatus.textContent = "";
    } finally {
      loginBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await message({ type: "LOGOUT" });
    await refresh();
  });

  profileSelect.addEventListener("change", async () => {
    await message({ type: "SET_ACTIVE_PROFILE", profileId: profileSelect.value || null });
    status.textContent = "Profile updated";
  });

  triggerMode.addEventListener("change", async () => {
    await message({
      type: "UPDATE_SITE_BEHAVIOR",
      behavior: { triggerMode: triggerMode.value },
    });
    status.textContent = "Trigger mode saved";
  });

  submitMode.addEventListener("change", async () => {
    await message({
      type: "UPDATE_SITE_BEHAVIOR",
      behavior: { submitMode: submitMode.value },
    });
    status.textContent = "Submit mode saved";
  });

  fieldAssistEnabled.addEventListener("change", async () => {
    await message({
      type: "SET_FIELD_ASSIST_ENABLED",
      enabled: fieldAssistEnabled.checked,
    });
    status.textContent = fieldAssistEnabled.checked ? "Field assist on" : "Field assist off";
  });

  aiFillMissingFields.addEventListener("change", async () => {
    await message({
      type: "SET_AI_FILL_MISSING_FIELDS",
      enabled: aiFillMissingFields.checked,
    });
    status.textContent = aiFillMissingFields.checked
      ? "AI will draft unsaved open-ended fields on autofill"
      : "AI gap fill off";
  });

  fillNow.addEventListener("click", async () => {
    await message({ type: "RUN_AUTOFILL_ON_ACTIVE_TAB" });
    status.textContent = "Autofill triggered";
  });
}

void init();
