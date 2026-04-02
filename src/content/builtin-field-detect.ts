/**
 * Map a focused control to a profile "builtin" key (synced as knightdevs:builtin:*).
 * Aligns with Greenhouse/Lever/common ids and autocomplete.
 */

const ID_TO_BUILTIN: Record<string, string> = {
  first_name: "first_name",
  last_name: "last_name",
  email: "email",
  phone: "phone",
  linkedin: "linkedin",
  github: "github",
  twitter: "twitter",
  location: "location",
  candidate_location: "location",
  "candidate-location": "location",
  "candidate-location-input": "location",
};

const AUTOCOMPLETE_TO_BUILTIN: Record<string, string> = {
  "given-name": "first_name",
  "family-name": "last_name",
  email: "email",
  tel: "phone",
  url: "linkedin", // ambiguous; refined below
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function labelBlob(el: HTMLElement): string {
  const parts: string[] = [];
  const al = el.getAttribute("aria-label");
  if (al) parts.push(al);
  const id = el.id;
  if (id) {
    const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lab?.textContent) parts.push(lab.textContent);
  }
  const cl = el.closest("label");
  if (cl?.textContent) parts.push(cl.textContent);
  const wrap = el.closest(".field-wrapper, [class*='field']");
  if (wrap?.textContent) parts.push(wrap.textContent.slice(0, 200));
  return norm(parts.join(" "));
}

function builtinFromIdNameAndLabel(el: HTMLElement): string | null {
  const id = el.id?.trim().toLowerCase();
  if (id && ID_TO_BUILTIN[id]) return ID_TO_BUILTIN[id];

  const name = (el.getAttribute("name") || "").toLowerCase();
  if (name === "email" || name.endsWith("[email]")) return "email";
  if (name.includes("linkedin") || name.includes("urls[linkedin]")) return "linkedin";
  if (name.includes("github")) return "github";
  if (name.includes("twitter") || name.includes("x.com")) return "twitter";
  if (name.includes("phone") || name.includes("tel")) return "phone";
  if (name.includes("first") || name === "givenname") return "first_name";
  if (name.includes("last") || name === "familyname") return "last_name";
  if (name.includes("location")) return "location";

  const blob = labelBlob(el);
  if (/\bfirst name\b/.test(blob)) return "first_name";
  if (/\blast name\b/.test(blob)) return "last_name";
  if (/\bemail\b/.test(blob) && !blob.includes("confirm")) return "email";
  if (/\bphone\b|\bmobile\b|\btel\b/.test(blob)) return "phone";
  if (/\blinkedin\b/.test(blob)) return "linkedin";
  if (/\bgithub\b/.test(blob)) return "github";
  if (/\btwitter\b|\bx\s*\(twitter\)/.test(blob)) return "twitter";
  if (/\blocation\b|\bcity\b|\bwhere are you based\b/.test(blob)) return "location";

  return null;
}

/**
 * Returns a builtin key e.g. `first_name`, or null if this is not a standard profile field.
 */
export function detectBuiltinFieldKey(el: HTMLElement): string | null {
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) return null;
    return builtinFromIdNameAndLabel(el);
  }

  const tag = el.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea") return null;

  const input = el as HTMLInputElement;
  const fromCommon = builtinFromIdNameAndLabel(input);
  if (fromCommon) return fromCommon;

  const ac = (input.getAttribute("autocomplete") || "").toLowerCase();
  if (ac && AUTOCOMPLETE_TO_BUILTIN[ac]) {
    if (ac === "url") {
      const blob = labelBlob(el);
      if (blob.includes("github")) return "github";
      if (blob.includes("linkedin")) return "linkedin";
      if (blob.includes("twitter") || blob.includes(" x ")) return "twitter";
      return null;
    }
    return AUTOCOMPLETE_TO_BUILTIN[ac];
  }

  return null;
}
