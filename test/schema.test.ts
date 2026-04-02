import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCandidate } from "../src/lib/schema.js";

test("normalizeCandidate maps profile fields", () => {
  const candidate = normalizeCandidate(
    {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      core_skills: ["TypeScript", "React"],
      other_skills: ["Node.js"],
      requires_sponsorship: false,
    },
    "profile-1"
  );

  assert.equal(candidate.profileId, "profile-1");
  assert.equal(candidate.fullName, "Jane Doe");
  assert.equal(candidate.email, "jane@example.com");
  assert.deepEqual(candidate.skills, ["TypeScript", "React", "Node.js"]);
  assert.equal(candidate.requiresSponsorship, false);
});
