import assert from "node:assert/strict";
import test from "node:test";
import { getGoogleDriveAuthStatus } from "../src/utils/storageProvider.js";

const DRIVE_ENV_KEYS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ACCESS_TOKEN",
  "GOOGLE_DRIVE_BEARER_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

function withDriveEnv(values, callback) {
  const previous = Object.fromEntries(DRIVE_ENV_KEYS.map((key) => [key, process.env[key]]));
  DRIVE_ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    callback();
  } finally {
    DRIVE_ENV_KEYS.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test("Drive auth status distinguishes temporary and automatically refreshed credentials", () => {
  withDriveEnv({ GOOGLE_DRIVE_ACCESS_TOKEN: "temporary-token" }, () => {
    assert.deepEqual(getGoogleDriveAuthStatus(), {
      mode: "static_access_token",
      automaticRefresh: false,
      hasClientCredentials: false,
      hasRefreshToken: false,
      hasStaticAccessToken: true,
    });
  });

  withDriveEnv({
    GOOGLE_DRIVE_CLIENT_ID: "client-id",
    GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token",
  }, () => {
    assert.deepEqual(getGoogleDriveAuthStatus(), {
      mode: "oauth_refresh",
      automaticRefresh: true,
      hasClientCredentials: true,
      hasRefreshToken: true,
      hasStaticAccessToken: false,
    });
  });
});
