import PluginChallenge from "../models/PluginChallenge.js";
import {
  approveDeviceAuthorization,
  currentPluginUser,
  denyDeviceAuthorization,
  getDeviceAuthorization,
  listPluginSessions,
  pluginError,
  pollDeviceAuthorization,
  refreshPluginSession,
  revokePluginSession,
  revokePluginSessionForUser,
  startDeviceAuthorization,
} from "../services/pluginAuthService.js";
import {
  marketplaceTurnstileConfig,
  verifyMarketplaceTurnstile,
} from "../utils/turnstile.js";

export async function deviceStart(req, res, next) {
  try {
    return res.status(201).json(await startDeviceAuthorization(req, req.body));
  } catch (error) {
    return next(error);
  }
}

export function releaseManifest(_req, res) {
  const version = String(process.env.PLUGIN_RELEASE_VERSION || "0.1.0").trim();
  const downloadUrl = String(process.env.PLUGIN_RELEASE_URL || "").trim();
  const sha256 = String(process.env.PLUGIN_RELEASE_SHA256 || "").trim().toLowerCase();
  res.setHeader("cache-control", "public, max-age=300");
  return res.json({
    channel: String(process.env.PLUGIN_RELEASE_CHANNEL || "beta"),
    version,
    minimumVersion: String(process.env.PLUGIN_MINIMUM_VERSION || version),
    maxVersions: ["2026"],
    downloadUrl,
    sha256,
    signature: String(process.env.PLUGIN_RELEASE_SIGNATURE || ""),
    publishedAt: process.env.PLUGIN_RELEASE_PUBLISHED_AT || null,
  });
}

export async function deviceToken(req, res, next) {
  try {
    return res.json(await pollDeviceAuthorization(req, req.body?.deviceCode));
  } catch (error) {
    if (error.code === "SLOW_DOWN") {
      res.setHeader("retry-after", String(error.publicDetails?.retryAfter || 5));
    }
    return next(error);
  }
}

export async function refresh(req, res, next) {
  try {
    const token = String(req.body?.refreshToken || "");
    if (!token) {
      throw pluginError(400, "REFRESH_TOKEN_REQUIRED", "refreshToken is required.");
    }
    return res.json(await refreshPluginSession(req, token));
  } catch (error) {
    return next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await revokePluginSession(req.pluginSession, "logout");
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

export async function me(req, res, next) {
  try {
    return res.json(await currentPluginUser(req.user));
  } catch (error) {
    return next(error);
  }
}

export async function activationDetail(req, res, next) {
  try {
    return res.json(await getDeviceAuthorization(req.params.userCode));
  } catch (error) {
    return next(error);
  }
}

export async function activationApprove(req, res, next) {
  try {
    await approveDeviceAuthorization(req.user, req.params.userCode);
    return res.json({
      approved: true,
      userCode: String(req.params.userCode || "").toUpperCase(),
    });
  } catch (error) {
    return next(error);
  }
}

export async function activationDeny(req, res, next) {
  try {
    await denyDeviceAuthorization(req.params.userCode);
    return res.json({
      denied: true,
      userCode: String(req.params.userCode || "").toUpperCase(),
    });
  } catch (error) {
    return next(error);
  }
}

export async function sessions(req, res, next) {
  try {
    return res.json({ sessions: await listPluginSessions(req.user._id) });
  } catch (error) {
    return next(error);
  }
}

export async function revokeSession(req, res, next) {
  try {
    await revokePluginSessionForUser(req.user._id, req.params.sessionId);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

export async function challengeDetail(req, res, next) {
  try {
    const challenge = await PluginChallenge.findOne({
      challengeCode: String(req.params.code || ""),
      userId: req.user._id,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) {
      throw pluginError(404, "CHALLENGE_NOT_FOUND", "Challenge is invalid or expired.");
    }
    return res.json({
      code: challenge.challengeCode,
      assetId: challenge.assetId,
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      verification: marketplaceTurnstileConfig(),
    });
  } catch (error) {
    return next(error);
  }
}

export async function challengeApprove(req, res, next) {
  try {
    const code = String(req.params.code || "");
    const challenge = await PluginChallenge.findOne({
      challengeCode: code,
      userId: req.user._id,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) {
      throw pluginError(404, "CHALLENGE_NOT_FOUND", "Challenge is invalid or expired.");
    }
    await verifyMarketplaceTurnstile({
      token: req.body?.turnstileToken || req.body?.["cf-turnstile-response"],
      remoteIp: req.get?.("cf-connecting-ip") || req.ip || "",
      expectedCData: code,
    });
    await PluginChallenge.findByIdAndUpdate(challenge._id, {
      $set: { status: "approved", approvedAt: new Date() },
    });
    return res.json({ approved: true });
  } catch (error) {
    return next(error);
  }
}
