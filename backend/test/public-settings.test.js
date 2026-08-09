import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { getSettings, updateSettings } = await import("../src/controllers/settingsController.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");

test("guest settings only expose landing-page fields and input mode", async () => {
  await SiteSetting.create({
    key: "homepage",
    heroText: "TAI MODEL 3D66",
    heroSubtitle: "Dich vu getlink 3D66",
    heroEyebrow: "+ api 3d66 sdk",
    heroTextEn: "3D MODELS AND SCENES",
    heroSubtitleEn: "Affordable 3D66 downloads",
  });
  let payload;
  await getSettings(
    { user: null },
    { json(value) { payload = value; } },
    (error) => { throw error; },
  );

  assert.equal(typeof payload.settings.heroText, "string");
  assert.equal(typeof payload.settings.threed66ModelResolveMode, "string");
  assert.equal(payload.settings.referralRewardCreditEnabled, true);
  assert.equal(payload.settings.referralRewardProEnabled, true);
  assert.equal(Object.hasOwn(payload.settings, "threed66TimeoutMs"), false);
  assert.equal(Object.hasOwn(payload.settings, "threed66ProxyEnabled"), false);
  assert.equal(Object.hasOwn(payload.settings, "getlinkHistoryRetentionDaysAfterExpiry"), false);
  assert.equal(Object.hasOwn(payload.settings, "marketplaceDownloadHistoryRetentionDays"), false);
  assert.equal(Object.hasOwn(payload.settings, "_id"), false);
  assert.equal(payload.settings.heroText, "TAI MODEL 3D");
  assert.equal(payload.settings.heroSubtitle, "Dich vu getlink 3D");
  assert.equal(payload.settings.heroEyebrow, "+ api 3D sdk");
  assert.equal(payload.settings.heroTextEn, "3D MODELS AND SCENES");
  assert.equal(payload.settings.heroSubtitleEn, "Affordable 3D downloads");

  const stored = await SiteSetting.findOne({ key: "homepage" });
  assert.equal(stored.heroText, "TAI MODEL 3D");
  assert.equal(stored.heroSubtitle, "Dich vu getlink 3D");
  assert.equal(stored.heroSubtitleEn, "Affordable 3D downloads");
});

test("admin can update Vietnamese and English homepage text together", async () => {
  let payload;
  await updateSettings(
    {
      body: {
        heroText: "MODEL 3D\nSCENES\nGETLINK",
        heroTextEn: "3D MODELS\nSCENES\nGETLINK",
      },
    },
    { json(value) { payload = value; } },
    (error) => { throw error; },
  );

  assert.equal(payload.settings.heroText, "MODEL 3D\nSCENES\nGETLINK");
  assert.equal(payload.settings.heroTextEn, "3D MODELS\nSCENES\nGETLINK");
});

test("admin retention settings support forever and enforce safe active ranges", async () => {
  let payload;
  await updateSettings(
    {
      body: {
        getlinkDetailRetentionDaysAfterExpiry: -5,
        getlinkHistoryRetentionDaysAfterExpiry: 0,
        marketplaceDownloadHistoryRetentionDays: 9999,
      },
    },
    {
      json(value) { payload = value; return value; },
      status() { return this; },
    },
    (error) => { throw error; },
  );

  assert.equal(payload.settings.getlinkDetailRetentionDaysAfterExpiry, 1);
  assert.equal(payload.settings.getlinkHistoryRetentionDaysAfterExpiry, 0);
  assert.equal(payload.settings.marketplaceDownloadHistoryRetentionDays, 3650);
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

test("admin cannot disable every referral reward", async () => {
  let payload;
  let statusCode = 200;
  await updateSettings(
    {
      body: {
        referralRewardCreditEnabled: false,
        referralRewardProEnabled: false,
      },
      user: { role: "admin", email: "admin@example.test" },
      jwtPayload: { is2FAVerified: true },
    },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    },
    (error) => { throw error; },
  );

  assert.equal(statusCode, 400);
  assert.equal(payload.code, "REFERRAL_REWARD_REQUIRED");
});
