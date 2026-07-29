import assert from "node:assert/strict";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: PluginDeviceSession } = await import("../src/models/PluginDeviceSession.js");
const {
  approveDeviceAuthorization,
  pollDeviceAuthorization,
  refreshPluginSession,
  startDeviceAuthorization,
  verifyPluginAccessToken,
} = await import("../src/services/pluginAuthService.js");

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
