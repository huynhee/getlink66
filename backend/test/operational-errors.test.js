import assert from "node:assert/strict";
import test from "node:test";
import { isExpectedServiceUnavailable } from "../src/utils/operationalErrors.js";

test("disabled plugin feature gates are expected service unavailability", () => {
  assert.equal(isExpectedServiceUnavailable({ code: "PLUGIN_API_DISABLED" }, 503), true);
  assert.equal(isExpectedServiceUnavailable({ code: "PLUGIN_RELEASE_DISABLED" }, 503), true);
});

test("unexpected service failures still use server error reporting", () => {
  assert.equal(isExpectedServiceUnavailable({ code: "PLUGIN_RELEASE_SIGNATURE_INVALID" }, 503), false);
  assert.equal(isExpectedServiceUnavailable({ code: "PLUGIN_RELEASE_DISABLED" }, 500), false);
  assert.equal(isExpectedServiceUnavailable({}, 503), false);
});
