import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccountModelId } from "../src/utils/parse3d66.js";

function configure(t, accountId, marker) {
  const previous = {
    THREED66_ACCOUNT_ID: process.env.THREED66_ACCOUNT_ID,
    THREED66_ACCOUNT_MARKER: process.env.THREED66_ACCOUNT_MARKER,
  };
  process.env.THREED66_ACCOUNT_ID = accountId;
  process.env.THREED66_ACCOUNT_MARKER = marker;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("a comment-only marker cannot become the digits from THREED66 in the comment", (t) => {
  configure(t, "177536980", "# Override marker; derive from THREED66_ACCOUNT_ID when empty.");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH89635771442400");
});

test("inline comment digits cannot become part of an explicit marker", (t) => {
  configure(t, "177536980", " 12345678 # THREED66 example 89635771 ");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH12345678442400");
});

test("inline comments do not change the account used to derive the marker", (t) => {
  configure(t, "123456780 # THREED66 account, not 177536980", "");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH87654321442400");
});

test("a malformed marker cannot silently extract unrelated digits", (t) => {
  configure(t, "177536980", "THREED66_ACCOUNT_ID=123456780");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH89635771442400");
});

test("a missing or malformed account uses the existing default", (t) => {
  configure(t, "# THREED66 sample 123456780", "");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH89635771442400");
});

test("a plain configured marker remains stable", (t) => {
  configure(t, "177536980", " 12345678 ");
  assert.equal(normalizeAccountModelId("BCH01077971442400"), "BCH12345678442400");
  assert.equal(normalizeAccountModelId("BCH12345678442400"), "BCH12345678442400");
});
