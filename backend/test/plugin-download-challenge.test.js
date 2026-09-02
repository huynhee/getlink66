import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.PLUGIN_DOWNLOAD_CHALLENGE_MODE = "always";
process.env.CLIENT_URL = "https://3dipl.org";

const { default: User } = await import("../src/models/User.js");
const { default: PluginChallenge } = await import("../src/models/PluginChallenge.js");
const { default: PluginDeviceSession } = await import("../src/models/PluginDeviceSession.js");
const { pluginDownloadChallenge } = await import("../src/middleware/pluginDownloadChallenge.js");

async function runMiddleware(req) {
  return new Promise((resolve) => {
    pluginDownloadChallenge(req, {}, (error) => resolve(error || null));
  });
}

test("plugin download challenge is single-use and bound to user, device and asset", async () => {
  const user = await User.create({ email: "plugin-challenge@example.test", name: "Challenge" });
  const session = await PluginDeviceSession.create({
    userId: user._id,
    deviceName: "QA Device",
    pluginVersion: "0.1.0",
    maxVersion: "2026",
    absoluteExpiresAt: new Date(Date.now() + 60_000),
  });
  const request = {
    user,
    pluginSession: session,
    params: { id: "asset-123" },
    body: {},
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? "operation-1" : "";
    },
  };

  const required = await runMiddleware(request);
  assert.equal(required.code, "CHALLENGE_REQUIRED");
  assert.match(required.publicDetails.challengeUrl, /^https:\/\/3dipl\.org\/plugin\/challenge/);
  assert.ok(required.publicDetails.challengeToken);

  const challenge = await PluginChallenge.findOne({
    userId: user._id,
    sessionId: session._id,
    assetId: "asset-123",
  });
  await PluginChallenge.findByIdAndUpdate(challenge._id, {
    $set: { status: "approved", approvedAt: new Date() },
  });

  const approved = await runMiddleware({
    ...request,
    body: { challengeToken: required.publicDetails.challengeToken },
  });
  assert.equal(approved, null);
  assert.equal((await PluginChallenge.findById(challenge._id)).status, "consumed");

  const sameOperationRetry = await runMiddleware(request);
  assert.equal(sameOperationRetry, null);

  const replay = await runMiddleware({
    ...request,
    body: { challengeToken: required.publicDetails.challengeToken },
  });
  assert.equal(replay.code, "CHALLENGE_INVALID");

  const otherOperation = await runMiddleware({
    ...request,
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? "operation-2" : "";
    },
  });
  assert.equal(otherOperation.code, "CHALLENGE_REQUIRED");
});

test("risk challenge trusts the approved device session for later downloads", async () => {
  process.env.PLUGIN_DOWNLOAD_CHALLENGE_MODE = "risk";
  process.env.PLUGIN_DOWNLOAD_CHALLENGE_TRUST_HOURS = "168";
  const user = await User.create({ email: "plugin-trust@example.test", name: "Trusted" });
  const session = await PluginDeviceSession.create({
    userId: user._id,
    deviceName: "Trusted Device",
    pluginVersion: "0.4.0",
    maxVersion: "2026",
    absoluteExpiresAt: new Date(Date.now() + 60_000),
    riskChallengeRequired: true,
  });
  const request = {
    user,
    pluginSession: session,
    params: { id: "asset-trusted" },
    body: {},
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? "trusted-operation-1" : "";
    },
  };

  const required = await runMiddleware(request);
  const challenge = await PluginChallenge.findOne({
    userId: user._id,
    sessionId: session._id,
    assetId: "asset-trusted",
  });
  await PluginChallenge.findByIdAndUpdate(challenge._id, {
    $set: { status: "approved", approvedAt: new Date() },
  });

  assert.equal(await runMiddleware({
    ...request,
    body: { challengeToken: required.publicDetails.challengeToken },
  }), null);

  const trustedSession = await PluginDeviceSession.findById(session._id);
  assert.equal(trustedSession.riskChallengeRequired, false);
  assert.ok(new Date(trustedSession.challengeTrustedUntil) > new Date());

  const laterDownload = await runMiddleware({
    ...request,
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? "trusted-operation-2" : "";
    },
  });
  assert.equal(laterDownload, null);
  assert.equal(await PluginChallenge.countDocuments({ sessionId: session._id }), 1);
  process.env.PLUGIN_DOWNLOAD_CHALLENGE_MODE = "always";
});
