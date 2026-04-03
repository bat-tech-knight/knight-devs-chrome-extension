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

  autofillLog("Lever: address line 1", { has: !!candidate.addressLine1?.trim() });
  if (candidate.addressLine1?.trim()) {
    if (
      await tryFillBySelectors(
        ["input[autocomplete='street-address' i]", "input[autocomplete='address-line1' i]"],
        candidate.addressLine1
      )
    ) {
      filledFields += 1;
      autofillLog("Lever: address line 1 → filled", {});
    } else {
      missingFields.push("address_line1");
      autofillLog("Lever: address line 1 → not filled", {});
    }
  }

  const cityForLever = candidate.addressCity?.trim() || candidate.location?.trim();
  autofillLog("Lever: city / location", { has: !!cityForLever });
  if (cityForLever) {
    if (
      await tryFillBySelectors(
        ["input[name='location']", "input[autocomplete='address-level2' i]", "input[name='city' i]"],
        cityForLever
      )
    ) {
      filledFields += 1;
      autofillLog("Lever: city → filled", {});
    } else {
      missingFields.push("city_or_location");
      autofillLog("Lever: city → not filled", {});
    }
  }

  autofillLog("Lever: state", { has: !!candidate.addressState?.trim() });
  if (candidate.addressState?.trim()) {
    if (
      await tryFillBySelectors(
        ["input[autocomplete='address-level1' i]", "input[name='state' i]", "input[name='province' i]"],
        candidate.addressState
      )
    ) {
      filledFields += 1;
      autofillLog("Lever: state → filled", {});
    } else {
      missingFields.push("address_state");
      autofillLog("Lever: state → not filled", {});
    }
  }

  autofillLog("Lever: country", { has: !!candidate.addressCountry?.trim() });
  if (candidate.addressCountry?.trim()) {
    if (await tryFillBySelectors(["input[autocomplete='country' i]", "input[name='country' i]"], candidate.addressCountry)) {
      filledFields += 1;
      autofillLog("Lever: country → filled", {});
    } else {
      missingFields.push("address_country");
      autofillLog("Lever: country → not filled", {});
    }
  }

  autofillLog("Lever: postal", { has: !!candidate.addressPostalCode?.trim() });
  if (candidate.addressPostalCode?.trim()) {
    if (
      await tryFillBySelectors(
        ["input[autocomplete='postal-code' i]", "input[name='zip' i]", "input[name='postal' i]"],
        candidate.addressPostalCode
      )
    ) {
      filledFields += 1;
      autofillLog("Lever: postal → filled", {});
    } else {
      missingFields.push("address_postal_code");
      autofillLog("Lever: postal → not filled", {});
    }
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
