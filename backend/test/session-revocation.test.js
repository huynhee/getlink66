import test from "node:test";
import assert from "node:assert/strict";
import { sessionVersionMatches } from "../src/middleware/jwtAuth.js";

test("session version revokes tokens issued before logout", () => {
  assert.equal(
    sessionVersionMatches({ sv: 4 }, { sessionVersion: 4 }),
    true,
  );
  assert.equal(
    sessionVersionMatches({ sv: 4 }, { sessionVersion: 5 }),
    false,
  );
});

test("legacy tokens remain valid until the account session version changes", () => {
  assert.equal(sessionVersionMatches({}, { sessionVersion: 0 }), true);
  assert.equal(sessionVersionMatches({}, { sessionVersion: 1 }), false);
});
