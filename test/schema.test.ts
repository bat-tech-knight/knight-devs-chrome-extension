import test from "node:test";
import assert from "node:assert/strict";
import { formatLocationFromProfileParts, normalizeCandidate } from "../src/lib/schema.js";

test("normalizeCandidate maps profile fields", () => {
  const candidate = normalizeCandidate(
    {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      core_skills: ["TypeScript", "React"],
      other_skills: ["Node.js"],
      us_work_authorized: true,
      requires_sponsorship: false,
    },
    "profile-1"
  );

  assert.equal(candidate.profileId, "profile-1");
  assert.equal(candidate.fullName, "Jane Doe");
  assert.equal(candidate.email, "jane@example.com");
  assert.deepEqual(candidate.skills, ["TypeScript", "React", "Node.js"]);
  assert.equal(candidate.usWorkAuthorized, true);
  assert.equal(candidate.requiresSponsorship, false);
});

test("normalizeCandidate maps structured address and derives location when missing", () => {
  const candidate = normalizeCandidate(
    {
      first_name: "A",
      last_name: "B",
      address_line1: "1 Main St",
      address_city: "Austin",
      address_state: "TX",
      address_postal_code: "78701",
      address_country: "USA",
    },
    "p2"
  );

  assert.equal(candidate.addressLine1, "1 Main St");
  assert.equal(candidate.addressCity, "Austin");
  assert.equal(candidate.addressState, "TX");
  assert.equal(candidate.addressPostalCode, "78701");
  assert.equal(candidate.addressCountry, "USA");
  assert.equal(candidate.location, "1 Main St, Austin, TX, 78701, USA");
});

test("normalizeCandidate prefers explicit location over derived", () => {
  const candidate = normalizeCandidate(
    {
      first_name: "A",
      last_name: "B",
      location: "Legacy one-line",
      address_city: "Austin",
    },
    "p3"
  );
  assert.equal(candidate.location, "Legacy one-line");
  assert.equal(candidate.addressCity, "Austin");
});

test("formatLocationFromProfileParts joins segments", () => {
  assert.equal(
    formatLocationFromProfileParts({
      address_line1: "  x ",
      address_city: "y",
      address_state: "",
      address_country: "z",
    }),
    "x, y, z"
  );
});
