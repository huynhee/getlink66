import assert from "node:assert/strict";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: PluginDeviceSession } = await import("../src/models/PluginDeviceSession.js");
const {
  approveDeviceAuthorization,
  pluginRequestIpHash,
  pollDeviceAuthorization,
  refreshPluginSession,
  startDeviceAuthorization,
  verifyPluginAccessToken,
} = await import("../src/services/pluginAuthService.js");

test("plugin risk identity uses the visitor IP instead of rotating Cloudflare edges", () => {
  const first = {
    ip: "162.158.193.114",
    get: () => "203.0.113.42",
  };
  const second = {
    ip: "162.159.98.221",
    get: () => "203.0.113.42",
  };

  assert.equal(pluginRequestIpHash(first), pluginRequestIpHash(second));
});

function request(ip = "127.0.0.1") {
  return {
    ip,
    get(name) {
      return name.toLowerCase() === "cf-connecting-ip" ? ip : "";
    },
  };
}

test("plugin device approval issues scoped access and rotating refresh tokens", async () => {
  const user = await User.create({
    email: "plugin-auth@example.test",
    name: "Plugin Auth",
    credit: 0,
  });
  const started = await startDeviceAuthorization(request(), {
    deviceName: "WORKSTATION-01",
    pluginVersion: "0.1.0",
    maxVersion: "2026",
  });
  assert.match(started.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(started.interval, 5);

  await approveDeviceAuthorization(user, started.userCode);
  const issued = await pollDeviceAuthorization(request(), started.deviceCode);
  assert.equal(issued.expiresIn, 900);
  assert.ok(issued.accessToken);
  assert.ok(issued.refreshToken);
  const payload = verifyPluginAccessToken(issued.accessToken);
  assert.equal(payload.sub, String(user._id));
  assert.equal(payload.tokenType, "plugin_access");

  const refreshed = await refreshPluginSession(request(), issued.refreshToken);
  assert.notEqual(refreshed.refreshToken, issued.refreshToken);
  assert.ok(refreshed.accessToken);

  await assert.rejects(
    () => refreshPluginSession(request(), issued.refreshToken),
    (error) => error.code === "REFRESH_REPLAY",
  );
  const session = await PluginDeviceSession.findById(issued.sessionId);
  assert.equal(session.revokeReason, "refresh_replay");
  assert.ok(session.revokedAt);
});

test("protocol 2 app callback preserves state without exposing deviceCode", async () => {
  const user = await User.create({
    email: "plugin-callback@example.test",
    name: "Plugin Callback",
    credit: 50,
  });
  const appState = "A".repeat(43);
  const started = await startDeviceAuthorization(request(), {
    deviceName: "WORKSTATION-V2",
    pluginVersion: "0.4.0",
    maxVersion: "2026",
    deviceId: "device-id-0123456789abcdef0123456789abcdef",
    callbackMode: "app",
    appState,
  });

  assert.equal(started.appCallbackUri, "threedipl://auth/callback");
  assert.match(started.verificationUriComplete, /[?&]app=1(?:&|$)/);
  assert.match(started.verificationUriComplete, /[?&]state=A{43}(?:&|$)/);
  assert.equal(started.verificationUriComplete.includes(started.deviceCode), false);

  await assert.rejects(
    () => approveDeviceAuthorization(user, started.userCode, "B".repeat(43)),
    (error) => error.code === "APP_STATE_MISMATCH",
  );

  const approved = await approveDeviceAuthorization(user, started.userCode, appState);
  assert.equal(
    approved.callbackUri,
    `threedipl://auth/callback?status=approved&state=${appState}&code=${started.userCode}`,
  );
  await assert.rejects(
    () => approveDeviceAuthorization(user, started.userCode, appState),
    (error) => error.code === "DEVICE_CODE_NOT_FOUND",
  );

  const issued = await pollDeviceAuthorization(request(), started.deviceCode);
  assert.ok(issued.accessToken);
});

test("protocol 2 rejects malformed callback mode inputs", async () => {
  await assert.rejects(
    () => startDeviceAuthorization(request(), {
      deviceName: "WORKSTATION-V2",
      pluginVersion: "0.4.0",
      maxVersion: "2026",
      deviceId: "short",
      callbackMode: "app",
      appState: "short",
    }),
    (error) => error.code === "INVALID_APP_CALLBACK_REQUEST",
  );
});
