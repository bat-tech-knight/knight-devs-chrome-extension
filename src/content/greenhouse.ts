import { isContextAlive } from "../lib/extension-context.js";
import { sendExtensionMessage } from "../lib/extension-messaging.js";
import type { AutofillCandidate, FillReport } from "../lib/schema.js";
import { tryGreenhouseCoverLetterAi } from "./cover-letter-ai-fill.js";
import { autofillLog } from "./autofill-log.js";
import {
  assignFileToFileInput,
  fillTextInput,
  tryFillByLabel,
  tryFillBySelectors,
  tryFillReactSelect,
  tryFillReactSelectByLabel,
  tryFillSelect,
} from "./fill-engine.js";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function fetchResumeFromBackground(profileId: string): Promise<{
  base64: string;
  mimeType: string;
  filename: string;
}> {
  if (!isContextAlive()) throw new Error("Extension context invalidated.");
  const res = await sendExtensionMessage<{
    ok?: boolean;
    error?: string;
    base64?: string;
    mimeType?: string;
    filename?: string;
  }>({ type: "FETCH_RESUME_FOR_AUTOFILL", profileId });
  if (!res || res.ok === false) {
    throw new Error(typeof res?.error === "string" ? res.error : "Resume fetch failed");
  }
  const base64 = String(res.base64 ?? "");
  if (!base64) throw new Error("Empty resume payload");
  return {
    base64,
    mimeType: String(res.mimeType ?? "application/pdf"),
    filename: String(res.filename ?? "resume.pdf"),
  };
}

function findGreenhouseResumeFileInput(): HTMLInputElement | null {
  return (
    document.querySelector<HTMLInputElement>("input#resume[type='file']") ??
    document.querySelector<HTMLInputElement>("#application-form input#resume[type='file']")
  );
}

async function tryAttachGreenhouseResumePdf(candidate: AutofillCandidate): Promise<boolean> {
  const input = findGreenhouseResumeFileInput();
  if (!input) {
    autofillLog("Greenhouse: resume PDF — no file input", {});
    return false;
  }
  if (input.files && input.files.length > 0) {
    autofillLog("Greenhouse: resume PDF — already attached", {});
    return true;
  }
  try {
    const { base64, mimeType, filename } = await fetchResumeFromBackground(candidate.profileId);
    const buf = base64ToArrayBuffer(base64);
    const file = new File([buf], filename, { type: mimeType });
    return assignFileToFileInput(input, file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "NO_RESUME_FILE") {
      autofillLog("Greenhouse: resume PDF failed", { message: msg });
    }
    return false;
  }
}

function isResumeTextareaUsable(ta: HTMLTextAreaElement): boolean {
  try {
    if (ta.disabled || ta.readOnly) return false;
    const st = window.getComputedStyle(ta);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = ta.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch {
    return false;
  }
}

async function tryFillGreenhouseResumeManualText(candidate: AutofillCandidate): Promise<boolean> {
  const text = (candidate.resumeText || candidate.summary)?.trim();
  if (!text) return false;

  const findTa = (): HTMLTextAreaElement | null => {
    const byId = document.querySelector<HTMLTextAreaElement>("#resume_text");
    if (byId instanceof HTMLTextAreaElement && !byId.disabled && !byId.readOnly) return byId;
    const inUpload = document.querySelector<HTMLTextAreaElement>(".file-upload textarea");
    if (inUpload instanceof HTMLTextAreaElement && !inUpload.disabled && !inUpload.readOnly) return inUpload;
    const named = document.querySelector<HTMLTextAreaElement>(
      "textarea[name='resume_text'], textarea[name*='resume'][name*='text' i]"
    );
    if (named instanceof HTMLTextAreaElement && !named.disabled && !named.readOnly) return named;
    return null;
  };

  let ta = findTa();
  if (!ta || !isResumeTextareaUsable(ta)) {
    const manualBtn =
      document.querySelector<HTMLButtonElement>("button[data-testid='resume-text']") ??
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".file-upload button.btn, .file-upload button")
      ).find((b) => (b.textContent || "").toLowerCase().includes("enter manually")) ??
      null;
    if (!manualBtn) {
      autofillLog("Greenhouse: resume manual — no Enter manually button", {});
      return false;
    }
    manualBtn.click();
    for (let i = 0; i < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 80));
      ta = findTa();
      if (ta && isResumeTextareaUsable(ta)) break;
    }
  }

  if (!(ta instanceof HTMLTextAreaElement) || !isResumeTextareaUsable(ta)) {
    autofillLog("Greenhouse: resume manual — textarea not found", {});
    return false;
  }

  return fillTextInput(ta, text);
}

async function tryFillGreenhouseResume(candidate: AutofillCandidate): Promise<boolean> {
  if (await tryAttachGreenhouseResumePdf(candidate)) return true;
  return tryFillGreenhouseResumeManualText(candidate);
}

async function fillField(
  selectors: string[],
  labelTexts: string[],
  value?: string
): Promise<boolean> {
  if (!value?.trim()) return false;
  if (await tryFillBySelectors(selectors, value)) return true;
  if (await tryFillByLabel(document, labelTexts, value)) return true;
  return false;
}

async function waitForApplicationForm(maxMs: number): Promise<void> {
  autofillLog("Greenhouse: wait for form", { maxMs, selector: "#application-form #first_name" });
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (document.querySelector("#application-form #first_name")) {
      autofillLog("Greenhouse: form detected", { elapsedMs: Date.now() - t0 });
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  autofillLog("Greenhouse: form wait ended (timeout or continuing anyway)", {
    elapsedMs: Date.now() - t0,
    firstNamePresent: !!document.querySelector("#first_name"),
  });
}

export async function fillGreenhouse(candidate: AutofillCandidate): Promise<FillReport> {
  autofillLog("Greenhouse: fillGreenhouse start", { profileId: candidate.profileId });
  await waitForApplicationForm(10000);

  let filledFields = 0;
  const missingFields: string[] = [];

  const fill = async (
    key: string,
    selectors: string[],
    labels: string[],
    value?: string,
    required = false
  ): Promise<void> => {
    const hasValue = !!value?.trim();
    autofillLog(`Greenhouse: field "${key}"`, { hasValue, required });

    if (await fillField(selectors, labels, value)) {
      filledFields += 1;
      autofillLog(`Greenhouse: field "${key}" → filled`, {});
      return;
    }

    if (required) {
      missingFields.push(key);
      autofillLog(`Greenhouse: field "${key}" → MISSING (required)`, { hadValue: hasValue });
    } else if (hasValue) {
      autofillLog(`Greenhouse: field "${key}" → not filled (optional)`, {});
    }
  };

  await fill("first_name", ["#first_name", "input[autocomplete='given-name']"], ["first name"], candidate.firstName, true);

  await fill("last_name", ["#last_name", "input[autocomplete='family-name']"], ["last name"], candidate.lastName, true);

  await fill("email", ["#email", "input[autocomplete='email']", "input[type='email']"], ["email"], candidate.email, true);

  await fill("phone", ["#phone", "input.iti__tel-input", "input[type='tel']"], ["phone"], candidate.phone);

  await fill("linkedin", ["input[aria-label='LinkedIn Profile']", "input[aria-label*='LinkedIn']"], ["linkedin", "linkedin profile"], candidate.linkedin);

  await fill("github", ["input[aria-label*='GitHub']"], ["github", "github profile", "github url"], candidate.github);

  await fill("website", ["input[aria-label*='Website']", "input[aria-label*='Portfolio']"], ["website", "portfolio", "personal site"], candidate.website);

  const nickname = candidate.firstName || candidate.fullName?.split(" ")[0];
  await fill("nickname", ["input[aria-label*='Nickname']"], ["nickname"], nickname);

  {
    autofillLog("Greenhouse: cover letter (AI + manual entry)", {
      hasSummary: Boolean(candidate.summary?.trim()),
    });
    if (await tryGreenhouseCoverLetterAi(candidate)) {
      filledFields += 1;
      autofillLog("Greenhouse: cover letter → filled", {});
    } else if (await fillField(["textarea#cover_letter_text", "textarea[aria-label*='cover' i]"], ["cover letter"], candidate.summary)) {
      filledFields += 1;
      autofillLog("Greenhouse: cover letter → filled (plain textarea fallback)", {});
    } else if (candidate.summary?.trim()) {
      autofillLog("Greenhouse: cover letter → not filled (optional)", {});
    }
  }

  if (candidate.location?.trim()) {
    autofillLog("Greenhouse: location (React Select)", { length: candidate.location.length });
    if (await tryFillReactSelect("#candidate-location", candidate.location, candidate.location)) {
      filledFields += 1;
      autofillLog("Greenhouse: location → filled", {});
    } else {
      autofillLog("Greenhouse: location → failed", {});
    }
  } else {
    autofillLog("Greenhouse: location skipped (no profile value)", {});
  }

  if (candidate.requiresSponsorship !== undefined) {
    const sponsorText = candidate.requiresSponsorship ? "Yes" : "No";
    autofillLog("Greenhouse: sponsorship", { requiresSponsorship: candidate.requiresSponsorship, sponsorText });
    if (tryFillSelect(document, ["sponsorship", "require sponsorship"], sponsorText)) {
      filledFields += 1;
      autofillLog("Greenhouse: sponsorship → filled via <select>", {});
    } else if (
      await tryFillReactSelectByLabel(document, ["sponsorship", "require sponsorship"], sponsorText, sponsorText)
    ) {
      filledFields += 1;
      autofillLog("Greenhouse: sponsorship → filled via React Select", {});
    } else {
      autofillLog("Greenhouse: sponsorship → failed", {});
    }
  } else {
    autofillLog("Greenhouse: sponsorship skipped (requiresSponsorship unset in profile)", {});
  }

  {
    const hasHint = Boolean(candidate.resumeUrl || candidate.resumeText || candidate.summary);
    autofillLog("Greenhouse: resume/CV", {
      hasUrl: Boolean(candidate.resumeUrl),
      hasText: Boolean(candidate.resumeText || candidate.summary),
    });
    if (await tryFillGreenhouseResume(candidate)) {
      filledFields += 1;
      autofillLog("Greenhouse: resume → filled (file or manual text)", {});
    } else {
      missingFields.push("resume");
      autofillLog(
        hasHint
          ? "Greenhouse: resume → failed (PDF attach + manual text)"
          : "Greenhouse: resume → MISSING (upload resume under Settings → Expert)",
        {}
      );
    }
  }

  const report = { site: "greenhouse" as const, filledFields, missingFields, submitted: false };
  autofillLog("Greenhouse: fillGreenhouse done", {
    filledFields: report.filledFields,
    missingFields: report.missingFields,
  });
  return report;
}
