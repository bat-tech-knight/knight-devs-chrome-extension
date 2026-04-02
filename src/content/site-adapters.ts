import type { AutofillCandidate, FillReport, SupportedSite } from "../lib/schema.js";
import { fillGeneric } from "./generic.js";
import { fillGreenhouse } from "./greenhouse.js";
import { fillLever } from "./lever.js";

export interface SiteAdapter {
  site: SupportedSite;
  matches(url: URL): boolean;
  fill(candidate: AutofillCandidate): FillReport | Promise<FillReport>;
}

const adapters: SiteAdapter[] = [
  {
    site: "greenhouse",
    matches(url) {
      return url.hostname.includes("greenhouse");
    },
    fill: fillGreenhouse,
  },
  {
    site: "lever",
    matches(url) {
      return url.hostname.includes("lever.co");
    },
    fill: fillLever,
  },
  {
    site: "generic",
    matches() {
      return true;
    },
    fill: fillGeneric,
  },
];

export function getAdapterForUrl(urlString: string): SiteAdapter | null {
  const url = new URL(urlString);
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
