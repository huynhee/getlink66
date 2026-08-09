import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import PluginDeviceAuthorization from "../models/PluginDeviceAuthorization.js";
import PluginDeviceSession from "../models/PluginDeviceSession.js";
import PluginRefreshToken from "../models/PluginRefreshToken.js";
import User from "../models/User.js";
import { pluginJwtSecret } from "../config/secrets.js";
import {
  isProActive,
  nextVietnamReset,
  vietnamDayKey,
} from "../utils/membershipService.js";

const DEVICE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SECONDS = 15 * 60;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function opaqueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function userCode() {
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += USER_CODE_ALPHABET[crypto.randomInt(0, USER_CODE_ALPHABET.length)];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function clean(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function ipHash(req) {
  return hash(req.ip || req.get?.("cf-connecting-ip") || "");
}

function qaRiskRequested(req) {
  if (String(process.env.PLUGIN_DEPLOYMENT_ENV || "").toLowerCase() !== "staging") {
    return false;
  }
  const expected = String(process.env.PLUGIN_QA_RISK_SECRET || "");
  const supplied = String(req.get?.("x-3dipl-qa-risk-secret") || "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function pluginError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details && typeof details === "object") {
    error.details = details;
    error.publicDetails = details;
  }
  return error;
}

function signAccessToken(session) {
  return jwt.sign(
    {
      sub: String(session.userId),
      sid: String(session._id),
      tokenType: "plugin_access",
    },
    pluginJwtSecret(),
    {
      algorithm: "HS256",
      audience: "3dipl-plugin",
      issuer: "3dipl.org",
      expiresIn: ACCESS_TTL_SECONDS,
    },
  );
}

async function publicUser(user) {
  const pro = isProActive(user);
  const tier = pro ? "member" : "free";
  const quota = await DailyDownloadQuota.findOne({
    dayKey: vietnamDayKey(),
    tier,
    userId: user._id,
    guestKey: "",
  });
  const limit = (pro ? Number(user.proDailyDownloadLimit || 100) : 5)
    + Number(quota?.bonusLimit || 0);
  const used = Number(quota?.count || 0);
  return {
    id: String(user._id),
    name: user.name || "",
    avatar: user.avatar || "",
    isPro: pro,
    proUntil: user.proUntil || null,
    credit: Number(user.credit || 0),
    downloadQuota: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt: quota?.resetAt || nextVietnamReset(),
    },
  };
}

async function createRefreshToken(session) {
  const refreshToken = opaqueToken();
  await PluginRefreshToken.create({
    sessionId: session._id,
    tokenHash: hash(refreshToken),
    status: "current",
    expiresAt: session.absoluteExpiresAt,
  });
  return refreshToken;
}

async function tokenResponse(session, user, refreshToken) {
  return {
    accessToken: signAccessToken(session),
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
    refreshExpiresAt: session.absoluteExpiresAt,
    sessionId: String(session._id),
    user: await publicUser(user),
  };
}

async function revokeSessionDocument(session, reason) {
  if (!session || session.revokedAt) return;
  const now = new Date();
  await PluginDeviceSession.findByIdAndUpdate(session._id, {
    $set: { revokedAt: now, revokeReason: clean(reason, 80) },
  });
  await PluginRefreshToken.updateMany(
    { sessionId: session._id, status: "current" },
    { $set: { status: "revoked", revokedAt: now } },
  );
}

export async function startDeviceAuthorization(req, input = {}) {
  const deviceName = clean(input.deviceName, 120);
  const pluginVersion = clean(input.pluginVersion, 40);
  const maxVersion = clean(input.maxVersion, 20);
  if (!deviceName || !pluginVersion || !maxVersion) {
    throw pluginError(
      400,
      "INVALID_DEVICE_REQUEST",
      "deviceName, pluginVersion and maxVersion are required.",
    );
  }

  const deviceCode = opaqueToken();
  let authorization;
  let allocatedUserCode = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = userCode();
    const codeHash = hash(code);
    if (await PluginDeviceAuthorization.exists({ userCodeHash: codeHash })) continue;
    const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);
    authorization = await PluginDeviceAuthorization.create({
      deviceCodeHash: hash(deviceCode),
      userCodeHash: codeHash,
      deviceIdHash: hash(
        clean(input.deviceId, 200)
          || `${deviceName}|${ipHash(req)}`,
      ),
      deviceName,
      pluginVersion,
      maxVersion,
      status: "pending",
      intervalSeconds: 5,
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + 24 * 60 * 60 * 1000),
      requestIpHash: ipHash(req),
      qaRiskRequested: qaRiskRequested(req),
    });
    allocatedUserCode = code;
    break;
  }
  if (!authorization) {
    throw pluginError(503, "USER_CODE_UNAVAILABLE", "Could not allocate a device code.");
  }

  const origin = String(
    process.env.CLIENT_URL
      || process.env.FRONTEND_URL
      || "https://3dipl.org",
  ).replace(/\/+$/, "");
  const verificationUri = `${origin}/plugin/activate`;
  return {
    deviceCode,
    userCode: allocatedUserCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(allocatedUserCode)}`,
    expiresIn: Math.floor(DEVICE_TTL_MS / 1000),
    interval: authorization.intervalSeconds,
  };
}

export async function pollDeviceAuthorization(req, deviceCode) {
  const codeHash = hash(deviceCode);
  const authorization = await PluginDeviceAuthorization.findOne({
    deviceCodeHash: codeHash,
  });
  if (!authorization) {
    throw pluginError(400, "EXPIRED_TOKEN", "Device authorization expired.");
  }
  const now = new Date();
  if (new Date(authorization.expiresAt) <= now) {
    throw pluginError(400, "EXPIRED_TOKEN", "Device authorization expired.");
  }

  const lastPoll = authorization.lastPolledAt
    ? new Date(authorization.lastPolledAt).getTime()
    : 0;
  const intervalMs = Math.max(1, Number(authorization.intervalSeconds || 5)) * 1000;
  await PluginDeviceAuthorization.findByIdAndUpdate(authorization._id, {
    $set: { lastPolledAt: now },
  });
  if (lastPoll && now.getTime() - lastPoll < intervalMs) {
    throw pluginError(400, "SLOW_DOWN", "Poll interval is too short.", {
      retryAfter: Math.ceil(intervalMs / 1000),
    });
  }
  if (authorization.status === "pending") {
    throw pluginError(400, "AUTHORIZATION_PENDING", "Waiting for browser approval.");
  }
  if (authorization.status === "denied") {
    throw pluginError(400, "ACCESS_DENIED", "Device authorization was denied.");
  }
  if (authorization.status !== "approved" || !authorization.userId) {
    throw pluginError(400, "EXPIRED_TOKEN", "Device authorization is no longer valid.");
  }

  const consumed = await PluginDeviceAuthorization.findOneAndUpdate(
    { _id: authorization._id, status: "approved" },
    { $set: { status: "consumed", consumedAt: now } },
    { new: true },
  );
  if (!consumed) {
    throw pluginError(400, "EXPIRED_TOKEN", "Device authorization is no longer valid.");
  }
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const currentIpHash = ipHash(req);
  const session = await PluginDeviceSession.create({
    userId: authorization.userId,
    deviceName: authorization.deviceName,
    pluginVersion: authorization.pluginVersion,
    maxVersion: authorization.maxVersion,
    createdIpHash: currentIpHash,
    lastIpHash: currentIpHash,
    lastUsedAt: now,
    absoluteExpiresAt,
    riskChallengeRequired:
      Boolean(authorization.qaRiskRequested)
      || Boolean(authorization.requestIpHash && authorization.requestIpHash !== currentIpHash),
  });
  const user = await User.findById(authorization.userId);
  if (!user) {
    await revokeSessionDocument(session, "user_missing");
    throw pluginError(401, "USER_NOT_FOUND", "The approved account no longer exists.");
  }
  return tokenResponse(session, user, await createRefreshToken(session));
}

export async function approveDeviceAuthorization(user, rawCode) {
  const code = clean(rawCode, 16).toUpperCase();
  const now = new Date();
  const authorization = await PluginDeviceAuthorization.findOneAndUpdate(
    { userCodeHash: hash(code), status: "pending", expiresAt: { $gt: now } },
    {
      $set: {
        status: "approved",
        userId: user._id,
        approvedAt: now,
      },
    },
    { new: true },
  );
  if (!authorization) {
    throw pluginError(404, "DEVICE_CODE_NOT_FOUND", "Device code is invalid or expired.");
  }
  return authorization;
}

export async function denyDeviceAuthorization(rawCode) {
  const code = clean(rawCode, 16).toUpperCase();
  const authorization = await PluginDeviceAuthorization.findOneAndUpdate(
    { userCodeHash: hash(code), status: "pending", expiresAt: { $gt: new Date() } },
    { $set: { status: "denied", deniedAt: new Date() } },
    { new: true },
  );
  if (!authorization) {
    throw pluginError(404, "DEVICE_CODE_NOT_FOUND", "Device code is invalid or expired.");
  }
  return authorization;
}

export async function getDeviceAuthorization(rawCode) {
  const code = clean(rawCode, 16).toUpperCase();
  const authorization = await PluginDeviceAuthorization.findOne({
    userCodeHash: hash(code),
    expiresAt: { $gt: new Date() },
  });
  if (!authorization) {
    throw pluginError(404, "DEVICE_CODE_NOT_FOUND", "Device code is invalid or expired.");
  }
  return {
    userCode: code,
    deviceName: authorization.deviceName,
    pluginVersion: authorization.pluginVersion,
    maxVersion: authorization.maxVersion,
    status: authorization.status,
    expiresAt: authorization.expiresAt,
  };
}

export async function refreshPluginSession(req, refreshToken) {
  const token = await PluginRefreshToken.findOne({ tokenHash: hash(refreshToken) });
  if (!token) {
    throw pluginError(401, "INVALID_REFRESH_TOKEN", "Plugin session is invalid.");
  }
  const session = await PluginDeviceSession.findById(token.sessionId);
  const now = new Date();
  if (!session || session.revokedAt || new Date(session.absoluteExpiresAt) <= now) {
    if (session) await revokeSessionDocument(session, "expired");
    throw pluginError(401, "SESSION_REVOKED", "Plugin session expired or was revoked.");
  }
  if (token.status !== "current") {
    await revokeSessionDocument(session, "refresh_replay");
    throw pluginError(401, "REFRESH_REPLAY", "Refresh token replay revoked this device session.");
  }

  const claimed = await PluginRefreshToken.findOneAndUpdate(
    { _id: token._id, status: "current" },
    { $set: { status: "rotated", rotatedAt: now } },
    { new: true },
  );
  if (!claimed) {
    await revokeSessionDocument(session, "refresh_race");
    throw pluginError(401, "REFRESH_REPLAY", "Refresh token replay revoked this device session.");
  }
  const currentIpHash = ipHash(req);
  await PluginDeviceSession.findByIdAndUpdate(session._id, {
    $set: {
      lastUsedAt: now,
      lastIpHash: currentIpHash,
      ...(session.lastIpHash && session.lastIpHash !== currentIpHash
        ? { riskChallengeRequired: true }
        : {}),
    },
  });
  const user = await User.findById(session.userId);
  if (!user) {
    await revokeSessionDocument(session, "user_missing");
    throw pluginError(401, "USER_NOT_FOUND", "Plugin account no longer exists.");
  }
  return tokenResponse(session, user, await createRefreshToken(session));
}

export async function revokePluginSession(session, reason = "logout") {
  await revokeSessionDocument(session, reason);
}

export async function listPluginSessions(userId) {
  const sessions = await PluginDeviceSession.find({
    userId,
    revokedAt: { $exists: false },
    absoluteExpiresAt: { $gt: new Date() },
  }).sort({ lastUsedAt: -1 });
  return sessions.map((session) => ({
    id: String(session._id),
    deviceName: session.deviceName,
    pluginVersion: session.pluginVersion,
    maxVersion: session.maxVersion,
    lastUsedAt: session.lastUsedAt,
    createdAt: session.createdAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  }));
}

export async function revokePluginSessionForUser(userId, sessionId) {
  const session = await PluginDeviceSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw pluginError(404, "PLUGIN_SESSION_NOT_FOUND", "Plugin session was not found.");
  }
  await revokeSessionDocument(session, "web_revoke");
}

export async function currentPluginUser(user) {
  return publicUser(user);
}

export function verifyPluginAccessToken(rawToken) {
  try {
    const payload = jwt.verify(rawToken, pluginJwtSecret(), {
      algorithms: ["HS256"],
      audience: "3dipl-plugin",
      issuer: "3dipl.org",
    });
    if (payload.tokenType !== "plugin_access" || !payload.sid || !payload.sub) {
      throw new Error("invalid token type");
    }
    return payload;
  } catch {
    throw pluginError(401, "INVALID_ACCESS_TOKEN", "Plugin access token is invalid.");
  }
}
