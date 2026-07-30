import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const {
  getSettings,
  updateSettings,
} = await import("../src/controllers/settingsController.js");

test("guest settings only expose landing-page fields and input mode", async () => {
  let payload;
  await getSettings(
    { user: null },
    { json(value) { payload = value; } },
    (error) => { throw error; },
  );

  assert.equal(typeof payload.settings.heroText, "string");
  assert.equal(typeof payload.settings.threed66ModelResolveMode, "string");
  assert.equal(Object.hasOwn(payload.settings, "threed66TimeoutMs"), false);
  assert.equal(Object.hasOwn(payload.settings, "threed66ProxyEnabled"), false);
  assert.equal(Object.hasOwn(payload.settings, "_id"), false);
});

test("admin can update browser navigation retry settings at runtime", async () => {
  const previousAdminEmails = process.env.ADMIN_EMAILS;
  const previousAttempts = process.env.THREED66_BROWSER_NAV_RETRIES;
  const previousDelay = process.env.THREED66_BROWSER_RETRY_DELAY_MS;
  let payload;

  try {
    process.env.ADMIN_EMAILS = "admin@example.test";
    await updateSettings(
      {
        body: {
          threed66BrowserNavRetries: 4,
          threed66BrowserRetryDelayMs: 2000,
        },
        user: {
          role: "admin",
          email: "admin@example.test",
          isTwoFactorEnabled: false,
        },
      },
      { json(value) { payload = value; } },
      (error) => { throw error; },
    );

    assert.equal(payload.settings.threed66BrowserNavRetries, 4);
    assert.equal(payload.settings.threed66BrowserRetryDelayMs, 2000);
    assert.equal(process.env.THREED66_BROWSER_NAV_RETRIES, "4");
    assert.equal(process.env.THREED66_BROWSER_RETRY_DELAY_MS, "2000");
  } finally {
    if (previousAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAdminEmails;
    if (previousAttempts === undefined) {
      delete process.env.THREED66_BROWSER_NAV_RETRIES;
    } else {
      process.env.THREED66_BROWSER_NAV_RETRIES = previousAttempts;
    }
    if (previousDelay === undefined) {
      delete process.env.THREED66_BROWSER_RETRY_DELAY_MS;
    } else {
      process.env.THREED66_BROWSER_RETRY_DELAY_MS = previousDelay;
    }
  }
});
