import type { AutofillCandidate, FillReport } from "../lib/schema.js";
import { autofillLog } from "./autofill-log.js";
import { tryGenericCoverLetterAi } from "./cover-letter-ai-fill.js";
import {
  fillTextInput,
  fillTextInputOrReactSelect,
  tryFillByLabel,
  tryFillBySelectors,
  tryFillSelect,
} from "./fill-engine.js";

function fieldBlob(el: Element): string {
  const name = (el.getAttribute("name") || "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  const ph = (el.getAttribute("placeholder") || "").toLowerCase();
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  const dataTest = (el.getAttribute("data-testid") || "").toLowerCase();
  return `${name} ${id} ${ac} ${ph} ${aria} ${dataTest}`;
}

function matchesKeywords(blob: string, keywords: string[]): boolean {
  return keywords.some((k) => blob.includes(k));
}

function isFillableTextControl(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled) return false;
  if (el.getAttribute("role") === "combobox") return true;
  if (el.readOnly) return false;
  const t = (el.type || "text").toLowerCase();
  const skip = new Set([
    "hidden", "submit", "button", "reset", "image", "file",
    "password", "checkbox", "radio", "range", "color",
    "date", "datetime-local", "month", "week", "time",
  ]);
  return !skip.has(t);
}

function collectCandidates(root: Document): (HTMLInputElement | HTMLTextAreaElement)[] {
  const nodes = Array.from(root.querySelectorAll("input, textarea"));
  const out: (HTMLInputElement | HTMLTextAreaElement)[] = [];
  for (const n of nodes) {
    if (isFillableTextControl(n) && !n.disabled && !n.readOnly) {
      out.push(n);
    }
  }
  return out;
}

async function tryFillFirstMatch(
  candidates: (HTMLInputElement | HTMLTextAreaElement)[],
  used: WeakSet<Element>,
  keywords: string[],
  value: string
): Promise<boolean> {
  if (!value.trim()) return false;
  for (const el of candidates) {
    if (used.has(el)) continue;
    const blob = fieldBlob(el);
    if (!matchesKeywords(blob, keywords)) continue;
    if (await fillTextInputOrReactSelect(el, value)) {
      used.add(el);
      return true;
    }
  }
  return false;
}

async function tryFillExactNameOrId(
  candidates: (HTMLInputElement | HTMLTextAreaElement)[],
  used: WeakSet<Element>,
  value: string
): Promise<boolean> {
  if (!value.trim()) return false;
  for (const el of candidates) {
    if (used.has(el)) continue;
    const nameAttr = (el.getAttribute("name") || "").toLowerCase();
    const idAttr = (el.id || "").toLowerCase();
    if (nameAttr === "name" || idAttr === "name") {
      if (await fillTextInputOrReactSelect(el, value)) {
        used.add(el);
        return true;
      }
    }
  }
  return false;
}

function tryFillLargestTextarea(
  root: Document,
  used: WeakSet<Element>,
  keywords: string[],
  value: string
): boolean {
  if (!value.trim()) return false;
  const areas = Array.from(root.querySelectorAll("textarea")).filter(
    (t): t is HTMLTextAreaElement => t instanceof HTMLTextAreaElement && !t.disabled && !t.readOnly && !used.has(t)
  );
  const scored = areas.map((t) => ({
    t,
    blob: fieldBlob(t),
    score: t.rows * Math.max(1, t.cols) + (t.value?.length ?? 0),
  }));
  const keywordMatch = scored.filter((x) => matchesKeywords(x.blob, keywords));
  const pool = keywordMatch.length > 0 ? keywordMatch : scored;
  pool.sort((a, b) => b.score - a.score);
  const pick = pool[0]?.t;
  if (pick && fillTextInput(pick, value)) {
    used.add(pick);
    return true;
  }
  return false;
}

/** Best-effort autofill for arbitrary job/application sites. */
export async function fillGeneric(candidate: AutofillCandidate): Promise<FillReport> {
  autofillLog("Generic: fillGeneric start", { profileId: candidate.profileId });

  const used = new WeakSet<Element>();
  const textEls = collectCandidates(document);
  autofillLog("Generic: collected text-like controls", { count: textEls.length });

  let filledFields = 0;
  const missingFields: string[] = [];

  const tryValue = async (key: string, value: string | undefined, fn: () => boolean | Promise<boolean>) => {
    if (!value?.trim()) {
      autofillLog(`Generic: skip "${key}" (no value)`, {});
      return;
    }
    autofillLog(`Generic: try "${key}"`, { valueLength: value.length });
    if (await fn()) {
      filledFields += 1;
      autofillLog(`Generic: "${key}" → filled`, {});
    } else {
      missingFields.push(key);
      autofillLog(`Generic: "${key}" → not filled`, {});
    }
  };

  await tryValue("first_name", candidate.firstName, async () =>
    (await tryFillFirstMatch(textEls, used, ["first", "given", "fname", "first_name", "firstname"], candidate.firstName!)) ||
    (await tryFillByLabel(document, ["first name"], candidate.firstName!))
  );
  await tryValue("last_name", candidate.lastName, async () =>
    (await tryFillFirstMatch(textEls, used, ["last", "family", "lname", "surname", "last_name", "lastname"], candidate.lastName!)) ||
    (await tryFillByLabel(document, ["last name", "surname", "family name"], candidate.lastName!))
  );
  await tryValue("full_name", candidate.fullName, async () => {
    if (
      await tryFillFirstMatch(
        textEls,
        used,
        ["full_name", "fullname", "your name", "applicant name", "candidate name", "legal name", "display name"],
        candidate.fullName!
      )
    )
      return true;
    if (await tryFillExactNameOrId(textEls, used, candidate.fullName!)) return true;
    return await tryFillByLabel(document, ["full name", "your name", "name"], candidate.fullName!);
  });

  await tryValue("email", candidate.email, async () =>
    (await tryFillFirstMatch(textEls, used, ["email", "e-mail", "mail"], candidate.email!)) ||
    (await tryFillByLabel(document, ["email", "email address"], candidate.email!))
  );
  await tryValue("phone", candidate.phone, async () =>
    (await tryFillFirstMatch(textEls, used, ["phone", "tel", "mobile", "cell", "whatsapp"], candidate.phone!)) ||
    (await tryFillByLabel(document, ["phone", "phone number", "mobile"], candidate.phone!))
  );
  await tryValue("address_line1", candidate.addressLine1, async () =>
    (await tryFillBySelectors(
      ["input[autocomplete='street-address' i]", "input[autocomplete='address-line1' i]"],
      candidate.addressLine1!
    )) ||
    (await tryFillFirstMatch(textEls, used, ["address-line1", "street-address", "street", "address1", "addr1", "line_1"], candidate.addressLine1!)) ||
    (await tryFillByLabel(document, ["address line 1", "street address"], candidate.addressLine1!))
  );
  await tryValue("address_city", candidate.addressCity, async () =>
    (await tryFillBySelectors(
      [
        "input[autocomplete='address-level2' i]",
        "input[autocomplete='locality' i]",
        "input[name='city' i]",
      ],
      candidate.addressCity!
    )) ||
    (await tryFillFirstMatch(textEls, used, ["address-level2", "locality", "town"], candidate.addressCity!)) ||
    (await tryFillByLabel(document, ["city", "town"], candidate.addressCity!))
  );
  await tryValue("address_state", candidate.addressState, async () =>
    (await tryFillBySelectors(
      [
        "input[autocomplete='address-level1' i]",
        "input[autocomplete='region' i]",
        "input[name='state' i]",
        "input[name='province' i]",
      ],
      candidate.addressState!
    )) ||
    (await tryFillFirstMatch(textEls, used, ["address-level1", "region", "province", "territory"], candidate.addressState!)) ||
    (await tryFillByLabel(document, ["state", "province", "region"], candidate.addressState!))
  );
  await tryValue("address_country", candidate.addressCountry, async () =>
    (await tryFillBySelectors(
      ["input[autocomplete='country' i]", "input[autocomplete='country-name' i]"],
      candidate.addressCountry!
    )) ||
    (await tryFillFirstMatch(textEls, used, ["country-name", "country"], candidate.addressCountry!)) ||
    (await tryFillByLabel(document, ["country"], candidate.addressCountry!))
  );
  await tryValue("address_postal_code", candidate.addressPostalCode, async () =>
    (await tryFillBySelectors(
      [
        "input[autocomplete='postal-code' i]",
        "input[autocomplete='zip-code' i]",
        "input[name='zip' i]",
        "input[name='postal' i]",
      ],
      candidate.addressPostalCode!
    )) ||
    (await tryFillFirstMatch(textEls, used, ["postal-code", "zip-code", "postcode", "postal", "zip"], candidate.addressPostalCode!)) ||
    (await tryFillByLabel(document, ["zip", "postal", "post code"], candidate.addressPostalCode!))
  );
  await tryValue("location", candidate.location, async () =>
    (await tryFillFirstMatch(textEls, used, ["currentlocation", "your_location"], candidate.location!)) ||
    (await tryFillFirstMatch(textEls, used, ["location"], candidate.location!)) ||
    (await tryFillByLabel(document, ["location", "where are you based", "based in"], candidate.location!))
  );
  await tryValue("linkedin", candidate.linkedin, async () =>
    (await tryFillFirstMatch(textEls, used, ["linkedin"], candidate.linkedin!)) ||
    (await tryFillByLabel(document, ["linkedin", "linkedin profile", "linkedin url"], candidate.linkedin!))
  );
  await tryValue("github", candidate.github, async () =>
    (await tryFillFirstMatch(textEls, used, ["github"], candidate.github!)) ||
    (await tryFillByLabel(document, ["github", "github profile", "github url"], candidate.github!))
  );
  await tryValue("website", candidate.website, async () =>
    (await tryFillFirstMatch(textEls, used, ["website", "portfolio", "personal site"], candidate.website!)) ||
    (await tryFillByLabel(document, ["website", "portfolio", "personal site"], candidate.website!))
  );

  const coverText = (candidate.summary || candidate.resumeText)?.trim();
  if (await tryGenericCoverLetterAi(candidate)) {
    filledFields += 1;
    autofillLog("Generic: cover letter → filled (AI / file-upload manual)", {});
  } else if (coverText) {
    autofillLog("Generic: try cover/summary textarea", { length: coverText.length });
    const coverFilled =
      tryFillLargestTextarea(document, used, ["cover", "letter", "message", "additional", "why", "motivation"], coverText) ||
      tryFillLargestTextarea(document, used, ["bio", "about", "summary", "description", "experience"], coverText);
    if (coverFilled) {
      filledFields += 1;
      autofillLog("Generic: cover/summary → filled", {});
    } else {
      missingFields.push("summary_or_cover");
      autofillLog("Generic: cover/summary → not filled", {});
    }
  } else {
    autofillLog("Generic: no summary/resumeText for cover", {});
  }

  if (candidate.workAuthorization?.trim()) {
    autofillLog("Generic: try work authorization <select>", {});
    if (
      tryFillSelect(
        document, ["authorized", "authorization", "eligib", "work status", "right to work", "visa status"],
        candidate.workAuthorization
      )
    ) {
      filledFields += 1;
      autofillLog("Generic: work authorization → filled", {});
    } else {
      autofillLog("Generic: work authorization → not filled", {});
    }
  }

  const report = { site: "generic" as const, filledFields, missingFields, submitted: false };
  autofillLog("Generic: fillGeneric done", {
    filledFields: report.filledFields,
    missingFields: report.missingFields,
  });
  return report;
}
