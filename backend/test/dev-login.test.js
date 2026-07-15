import test from "node:test";
import assert from "node:assert/strict";
import { resolveDevLoginPro } from "../src/controllers/authController.js";
import { membershipSnapshot } from "../src/utils/membershipService.js";

test("explicit dev-login Pro state overrides the local default", () => {
  const previous = process.env.DEV_LOGIN_PRO;
  process.env.DEV_LOGIN_PRO = "true";
  try {
    assert.equal(resolveDevLoginPro({ pro: "false" }), false);
    assert.equal(resolveDevLoginPro({ pro: "true" }), true);
    assert.equal(resolveDevLoginPro({}), true);
  } finally {
    if (previous === undefined) delete process.env.DEV_LOGIN_PRO;
    else process.env.DEV_LOGIN_PRO = previous;
  }
});

test("logged-in accounts expose only Free or Pro membership tiers", () => {
  const now = new Date("2026-07-15T00:00:00.000Z");
  assert.deepEqual(membershipSnapshot({ proUntil: null }, now), {
    active: false,
    tier: "free",
    proUntil: null,
    dailyDownloadLimit: 5,
  });

  const proUntil = new Date("2026-07-16T00:00:00.000Z");
  assert.deepEqual(membershipSnapshot({ proUntil, proDailyDownloadLimit: 100 }, now), {
    active: true,
    tier: "pro",
    proUntil,
    dailyDownloadLimit: 100,
  });
});
