import type { AutofillCandidate, FillReport } from "../lib/schema.js";
import { autofillLog } from "./autofill-log.js";
import { tryFillBySelectors } from "./fill-engine.js";

export async function fillLever(candidate: AutofillCandidate): Promise<FillReport> {
  autofillLog("Lever: fillLever start", { profileId: candidate.profileId });

  let filledFields = 0;
  const missingFields: string[] = [];

  autofillLog("Lever: name / fullName", { hasFullName: !!candidate.fullName?.trim() });
  if (await tryFillBySelectors(["input[name='name']", "input[autocomplete='name']"], candidate.fullName)) {
    filledFields += 1;
    autofillLog("Lever: name → filled", {});
  } else {
    missingFields.push("name");
    autofillLog("Lever: name → missing", {});
  }

  autofillLog("Lever: email", { hasEmail: !!candidate.email?.trim() });
  if (await tryFillBySelectors(["input[name='email']", "input[type='email']"], candidate.email)) {
    filledFields += 1;
    autofillLog("Lever: email → filled", {});
  } else {
    missingFields.push("email");
    autofillLog("Lever: email → missing", {});
  }

  autofillLog("Lever: phone", { hasPhone: !!candidate.phone?.trim() });
  if (await tryFillBySelectors(["input[name='phone']", "input[type='tel']"], candidate.phone)) {
    filledFields += 1;
    autofillLog("Lever: phone → filled", {});
  } else {
    autofillLog("Lever: phone → not filled", {});
  }

  autofillLog("Lever: location", { hasLocation: !!candidate.location?.trim() });
  if (await tryFillBySelectors(["input[name='location']", "input[autocomplete='address-level2']"], candidate.location)) {
    filledFields += 1;
    autofillLog("Lever: location → filled", {});
  } else {
    autofillLog("Lever: location → not filled", {});
  }

  autofillLog("Lever: linkedin", { hasLinkedin: !!candidate.linkedin?.trim() });
  if (await tryFillBySelectors(["input[name='urls[LinkedIn]']", "input[name*='linkedin']"], candidate.linkedin)) {
    filledFields += 1;
    autofillLog("Lever: linkedin → filled", {});
  } else {
    autofillLog("Lever: linkedin → not filled", {});
  }

  autofillLog("Lever: cover / comments", { hasSummary: !!candidate.summary?.trim() });
  if (await tryFillBySelectors(["textarea[name='comments']", "textarea[name*='cover']"], candidate.summary)) {
    filledFields += 1;
    autofillLog("Lever: cover → filled", {});
  } else {
    autofillLog("Lever: cover → not filled", {});
  }

  const submitted = false;
  const report = { site: "lever" as const, filledFields, missingFields, submitted };
  autofillLog("Lever: fillLever done", {
    filledFields: report.filledFields,
    missingFields: report.missingFields,
  });
  return report;
}
