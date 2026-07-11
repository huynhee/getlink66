import test from "node:test";
import assert from "node:assert/strict";
import { validateOAuthState } from "../src/controllers/authController.js";

function responseRecorder() {
  return {
    cleared: [],
    redirectedTo: "",
    clearCookie(name) {
      this.cleared.push(name);
    },
    redirect(value) {
      this.redirectedTo = value;
      return value;
    },
  };
}

test("OAuth callback accepts a matching state and consumes the cookie", () => {
  const state = "a".repeat(43);
  const req = {
    cookies: { oauthState: state },
    query: { state },
    ip: "127.0.0.1",
    path: "/api/auth/google/callback",
  };
  const res = responseRecorder();
  let nextCalled = false;

  validateOAuthState(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectedTo, "");
  assert.ok(res.cleared.includes("oauthState"));
});

test("OAuth callback rejects a missing or mismatched state", () => {
  const req = {
    cookies: { oauthState: "a".repeat(43) },
    query: { state: "b".repeat(43) },
    ip: "127.0.0.1",
    path: "/api/auth/google/callback",
  };
  const res = responseRecorder();
  let nextCalled = false;

  validateOAuthState(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.match(res.redirectedTo, /auth=state_error$/);
  assert.deepEqual(
    new Set(res.cleared),
    new Set(["oauthState", "oauthReturnTo", "oauthReferralCode"]),
  );
});
