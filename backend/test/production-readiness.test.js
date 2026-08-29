import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProductionReadiness,
  productionReadinessIssues,
} from "../src/config/productionReadiness.js";

function readyEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    CLIENT_URL: "https://3dipl.org",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SITE_KEY: "0x4AAAAAA-production-site-key",
    TURNSTILE_SECRET_KEY: "0x4AAAAAA-production-secret-key",
    TURNSTILE_EXPECTED_HOSTNAME: "3dipl.org",
    TURNSTILE_EXPECTED_ACTION: "marketplace_download",
    ADMIN_EMAILS: "admin@3dipl.org",
    ADMIN_2FA_REQUIRED: "true",
    ALLOW_DEV_LOGIN: "false",
    ALLOW_DEV_ADMIN_LOGIN: "false",
    THREED66_MOCK: "false",
    MARKETPLACE_STARTUP_MIGRATIONS_ENABLED: "false",
    PLUGIN_API_ENABLED: "false",
    PLUGIN_DEPLOYMENT_ENV: "production",
    MARKETPLACE_DB_TARGET: "vps",
    MONGO_CORE_URI: "mongodb+srv://core.example.test/core",
    MONGO_MARKETPLACE_URI: "mongodb://marketplace.example.test/marketplace?replicaSet=rs0",
    MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED: "true",
    DATABASE_BACKUP_DRIVE_FOLDER_ID: "backup-folder",
    BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    TRUST_PROXY: "true",
    MARKETPLACE_DOWNLOAD_DELIVERY: "proxy",
    HISTORY_RETENTION_JOB_ENABLED: "true",
    MARKETPLACE_DRIVE_WRITE_ENABLED: "true",
    SEPAY_ENABLED: "true",
    SEPAY_ENV: "production",
    MARKETPLACE_IMAGE_SEARCH_REQUIRED: "true",
    MARKETPLACE_IMAGE_SEARCH_URL: "https://image-search.internal.example.test/match",
    MARKETPLACE_IMAGE_SEARCH_API_KEY: "image-search-test-key",
    ...overrides,
  };
}

test("production readiness accepts the secure baseline", () => {
  assert.doesNotThrow(() => assertProductionReadiness(readyEnvironment()));
});

test("production readiness rejects Turnstile test keys and disabled admin 2FA", () => {
  const issues = productionReadinessIssues(readyEnvironment({
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    ADMIN_2FA_REQUIRED: "false",
  }));

  assert.ok(issues.errors.some((item) => item.includes("real production key")));
  assert.ok(issues.errors.some((item) => item.includes("real production secret")));
  assert.ok(issues.errors.some((item) => item.includes("ADMIN_2FA_REQUIRED")));
});

test("Drive redirect requires explicit public-link risk acceptance", () => {
  const blocked = productionReadinessIssues(readyEnvironment({
    MARKETPLACE_DOWNLOAD_DELIVERY: "drive_redirect",
    MARKETPLACE_ALLOW_PUBLIC_DRIVE_LINKS: "false",
  }));
  assert.ok(blocked.errors.some((item) => item.includes("explicit risk acceptance")));

  const accepted = productionReadinessIssues(readyEnvironment({
    MARKETPLACE_DOWNLOAD_DELIVERY: "drive_redirect",
    MARKETPLACE_ALLOW_PUBLIC_DRIVE_LINKS: "true",
  }));
  assert.equal(accepted.errors.length, 0);
  assert.ok(accepted.warnings.some((item) => item.includes("reusable Google Drive URL")));
});

test("plugin API configuration and automatic production migration are fail-closed", () => {
  const blocked = productionReadinessIssues(readyEnvironment({
    PLUGIN_API_ENABLED: "true",
    MARKETPLACE_STARTUP_MIGRATIONS_ENABLED: "true",
  }));
  assert.ok(blocked.errors.some((item) => item.includes("PLUGIN_JWT_SECRET")));
  assert.ok(blocked.errors.some((item) => item.includes("PLUGIN_RELEASE_URL")));
  assert.ok(blocked.errors.some((item) => item.includes("STARTUP_MIGRATIONS")));

  const ready = productionReadinessIssues(readyEnvironment({
    PLUGIN_API_ENABLED: "true",
    PLUGIN_JWT_SECRET: "x".repeat(48),
    PLUGIN_RELEASE_VERSION: "0.1.0",
    PLUGIN_MINIMUM_VERSION: "0.1.0",
    PLUGIN_RELEASE_URL: "https://3dipl.org/downloads/3dipl-0.1.0.mzp",
    PLUGIN_RELEASE_SHA256: "a".repeat(64),
    PLUGIN_RELEASE_SIGNATURE: "A".repeat(88),
    PLUGIN_RELEASE_PUBLIC_KEY: "A".repeat(124),
    PLUGIN_RELEASE_PUBLISHED_AT: "2026-07-26T00:00:00.000Z",
    PLUGIN_RELEASE_MANIFEST_VERSION: "2",
    PLUGIN_DESKTOP_RELEASE_URL: "https://3dipl.org/downloads/3dipl-desktop-0.3.1.zip",
    PLUGIN_DESKTOP_RELEASE_SHA256: "b".repeat(64),
    PLUGIN_DESKTOP_RELEASE_SIGNATURE: "B".repeat(88),
    PLUGIN_DESKTOP_RELEASE_PUBLISHED_AT: "2026-07-26T00:00:00.000Z",
    PLUGIN_DESKTOP_RELEASE_PROTOCOL_MINIMUM: "1",
    PLUGIN_DESKTOP_RELEASE_PROTOCOL_MAXIMUM: "1",
    PLUGIN_MAX_BRIDGE_RELEASE_URL: "https://3dipl.org/downloads/3dipl-bridge-0.3.1.mzp",
    PLUGIN_MAX_BRIDGE_RELEASE_SHA256: "c".repeat(64),
    PLUGIN_MAX_BRIDGE_RELEASE_SIGNATURE: "C".repeat(88),
    PLUGIN_MAX_BRIDGE_RELEASE_PUBLISHED_AT: "2026-07-26T00:00:00.000Z",
    PLUGIN_MAX_BRIDGE_RELEASE_PROTOCOL_MINIMUM: "1",
    PLUGIN_MAX_BRIDGE_RELEASE_PROTOCOL_MAXIMUM: "1",
    PLUGIN_DOWNLOAD_CHALLENGE_MODE: "risk",
  }));
  assert.equal(ready.errors.length, 0);
});

test("production image search requires an HTTPS provider unless explicitly disabled", () => {
  const blocked = productionReadinessIssues(readyEnvironment({
    MARKETPLACE_IMAGE_SEARCH_URL: "",
    MARKETPLACE_IMAGE_SEARCH_API_KEY: "",
  }));
  assert.ok(blocked.errors.some((item) => item.includes("IMAGE_SEARCH_URL")));
  assert.ok(blocked.errors.some((item) => item.includes("IMAGE_SEARCH_API_KEY")));

  const accepted = productionReadinessIssues(readyEnvironment({
    MARKETPLACE_IMAGE_SEARCH_REQUIRED: "false",
    MARKETPLACE_IMAGE_SEARCH_URL: "",
    MARKETPLACE_IMAGE_SEARCH_API_KEY: "",
  }));
  assert.equal(accepted.errors.length, 0);
  assert.ok(accepted.warnings.some((item) => item.includes("explicitly disabled")));
});
