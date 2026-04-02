import test from "node:test";
import assert from "node:assert/strict";
import { deriveSiteKey } from "../src/lib/storage.js";

test("deriveSiteKey detects greenhouse and lever", () => {
  assert.equal(deriveSiteKey("https://boards.greenhouse.io/company/jobs/1"), "greenhouse");
  assert.equal(deriveSiteKey("https://jobs.lever.co/company/abc"), "lever");
});
