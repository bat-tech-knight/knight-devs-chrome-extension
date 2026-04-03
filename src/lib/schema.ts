export type SupportedSite = "greenhouse" | "lever" | "generic";
export type TriggerMode = "manual" | "auto_on_load";
export type SubmitMode = "fill_only" | "fill_and_submit";

export interface ExpertProfileOption {
  id: string;
  displayName: string;
  role?: string | null;
}

export interface AutofillCandidate {
  profileId: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  addressLine1?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  addressPostalCode?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  summary?: string;
  resumeText?: string;
  /** Public/storage URL from API (optional); PDF attach uses authenticated proxy route by profileId. */
  resumeUrl?: string;
  workAuthorization?: string;
  /** Legally authorized to work in the United States (job application Yes/No). */
  usWorkAuthorized?: boolean;
  requiresSponsorship?: boolean;
  skills: string[];
  workExperience: string[];
  education: string[];
}

export interface SiteBehavior {
  triggerMode: TriggerMode;
  submitMode: SubmitMode;
}

export interface ExtensionState {
  activeProfileId: string | null;
  apiBaseUrl: string;
  siteBehavior: Record<string, SiteBehavior>;
  /** Show Grammarly-style chip on focused text fields (default true when unset). */
  fieldAssistEnabled?: boolean;
  /**
   * During autofill, use AI to draft answers for open-ended fields that still have no value
   * and no saved answer, then persist them for reuse.
   */
  aiFillMissingFields?: boolean;
}

export interface FillReport {
  site: SupportedSite;
  filledFields: number;
  missingFields: string[];
  submitted: boolean;
}

export const DEFAULT_SITE_BEHAVIOR: SiteBehavior = {
  triggerMode: "manual",
  submitMode: "fill_only",
};

/** Same segment order as `formatProfileLocation` on the platform. */
export function formatLocationFromProfileParts(raw: Record<string, unknown>): string {
  const segments = [
    stringOrUndefined(raw.address_line1),
    stringOrUndefined(raw.address_city),
    stringOrUndefined(raw.address_state),
    stringOrUndefined(raw.address_postal_code),
    stringOrUndefined(raw.address_country),
  ].filter(Boolean) as string[];
  return segments.join(", ");
}

export function normalizeCandidate(raw: Record<string, unknown>, profileId: string): AutofillCandidate {
  const firstName = stringOrEmpty(raw.first_name);
  const lastName = stringOrEmpty(raw.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || stringOrEmpty(raw.name);

  const derivedLocation = formatLocationFromProfileParts(raw);
  const locationFromRow = stringOrUndefined(raw.location);
  const location = locationFromRow ?? stringOrUndefined(derivedLocation);

  return {
    profileId,
    fullName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    email: stringOrUndefined(raw.email),
    phone: stringOrUndefined(raw.phone_number),
    location,
    addressLine1: stringOrUndefined(raw.address_line1),
    addressCity: stringOrUndefined(raw.address_city),
    addressState: stringOrUndefined(raw.address_state),
    addressCountry: stringOrUndefined(raw.address_country),
    addressPostalCode: stringOrUndefined(raw.address_postal_code),
    linkedin: stringOrUndefined(raw.linkedin_url),
    github: stringOrUndefined(raw.github_url),
    website: stringOrUndefined(raw.website_url),
    summary: stringOrUndefined(raw.summary),
    resumeText: stringOrUndefined(raw.resume_text),
    resumeUrl: stringOrUndefined(raw.resume_url),
    workAuthorization: stringOrUndefined(raw.work_authorization),
    usWorkAuthorized: booleanOrUndefined(raw.us_work_authorized),
    requiresSponsorship: booleanOrUndefined(raw.requires_sponsorship),
    skills: arrayOfStrings(raw.core_skills, raw.other_skills),
    workExperience: arrayOfStrings(raw.experience),
    education: arrayOfStrings(raw.education),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringOrEmpty(value: unknown): string {
  return stringOrUndefined(value) ?? "";
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function arrayOfStrings(...values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          result.push(item.trim());
        }
      }
    } else if (typeof value === "string" && value.trim()) {
      result.push(value.trim());
    }
  }
  return [...new Set(result)];
}
