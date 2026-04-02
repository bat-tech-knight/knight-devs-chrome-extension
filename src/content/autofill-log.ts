/** Filter DevTools console with: Knight Devs Autofill */
const PREFIX = "[Knight Devs Autofill]";

export function autofillLog(step: string, detail?: Record<string, unknown>): void {
  if (detail !== undefined && Object.keys(detail).length > 0) {
    console.log(PREFIX, step, detail);
  } else {
    console.log(PREFIX, step);
  }
}

export function describeField(el: HTMLInputElement | HTMLTextAreaElement): Record<string, string | null> {
  return {
    tag: el.tagName,
    id: el.id || null,
    name: el.getAttribute("name"),
    type: el instanceof HTMLInputElement ? el.type : "textarea",
    role: el.getAttribute("role"),
  };
}

/** Safe summary for logs (no full PII). */
export function candidateLogShape(c: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  summary?: string;
  requiresSponsorship?: boolean;
}): Record<string, unknown> {
  return {
    hasFirstName: !!c.firstName?.trim(),
    hasLastName: !!c.lastName?.trim(),
    hasEmail: !!c.email?.trim(),
    hasPhone: !!c.phone?.trim(),
    hasLocation: !!c.location?.trim(),
    hasLinkedin: !!c.linkedin?.trim(),
    hasGithub: !!c.github?.trim(),
    hasWebsite: !!c.website?.trim(),
    hasSummary: !!c.summary?.trim(),
    requiresSponsorship:
      c.requiresSponsorship === undefined ? "unset" : c.requiresSponsorship,
  };
}
