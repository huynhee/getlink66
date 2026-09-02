import crypto from "node:crypto";
import PluginChallenge from "../models/PluginChallenge.js";
import PluginDeviceSession from "../models/PluginDeviceSession.js";
import { pluginError } from "../services/pluginAuthService.js";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CHALLENGE_TRUST_HOURS = 7 * 24;

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function shouldRequireChallenge(req) {
  const mode = String(process.env.PLUGIN_DOWNLOAD_CHALLENGE_MODE || "risk").toLowerCase();
  if (mode === "always") return true;
  if (mode === "off") return false;
  const trustedUntil = req.pluginSession?.challengeTrustedUntil
    ? new Date(req.pluginSession.challengeTrustedUntil)
    : null;
  if (trustedUntil && trustedUntil > new Date()) return false;
  return Boolean(req.pluginSession?.riskChallengeRequired);
}

function challengeTrustUntil() {
  const configured = Number(process.env.PLUGIN_DOWNLOAD_CHALLENGE_TRUST_HOURS);
  const hours = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 30 * 24)
    : DEFAULT_CHALLENGE_TRUST_HOURS;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function trustApprovedSession(req) {
  if (String(process.env.PLUGIN_DOWNLOAD_CHALLENGE_MODE || "risk").toLowerCase() === "always") {
    return;
  }
  const trustedUntil = challengeTrustUntil();
  await PluginDeviceSession.findByIdAndUpdate(req.pluginSession._id, {
    $set: {
      riskChallengeRequired: false,
      challengeTrustedUntil: trustedUntil,
    },
  });
  req.pluginSession.riskChallengeRequired = false;
  req.pluginSession.challengeTrustedUntil = trustedUntil;
}

export async function pluginDownloadChallenge(req, _res, next) {
  try {
    if (!shouldRequireChallenge(req)) return next();

    const assetId = String(req.params.id || "");
    const idempotencyKey = String(req.get("idempotency-key") || "").trim();
    if (!idempotencyKey) {
      throw pluginError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
    }
    const idempotencyKeyHash = hash(idempotencyKey);
    const supplied = String(
      req.body?.challengeToken || req.get("x-3dipl-challenge-token") || "",
    );
    if (supplied) {
      const challenge = await PluginChallenge.findOneAndUpdate(
        {
          approvalTokenHash: hash(supplied),
          userId: req.user._id,
          sessionId: req.pluginSession._id,
          assetId,
          idempotencyKeyHash,
          status: "approved",
          expiresAt: { $gt: new Date() },
        },
        { $set: { status: "consumed", consumedAt: new Date() } },
        { new: true },
      );
      if (!challenge) {
        throw pluginError(
          403,
          "CHALLENGE_INVALID",
          "Plugin download challenge is invalid, expired or already used.",
        );
      }
      await trustApprovedSession(req);
      return next();
    }

    const approvedOperation = await PluginChallenge.exists({
      userId: req.user._id,
      sessionId: req.pluginSession._id,
      assetId,
      idempotencyKeyHash,
      status: "consumed",
      expiresAt: { $gt: new Date() },
    });
    if (approvedOperation) return next();

    const challengeCode = crypto.randomBytes(12).toString("base64url");
    const approvalToken = crypto.randomBytes(32).toString("base64url");
    await PluginChallenge.create({
      challengeCode,
      approvalTokenHash: hash(approvalToken),
      userId: req.user._id,
      sessionId: req.pluginSession._id,
      assetId,
      idempotencyKeyHash,
      status: "pending",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    const origin = String(
      process.env.CLIENT_URL
        || process.env.FRONTEND_URL
        || "https://3dipl.org",
    ).replace(/\/+$/, "");
    throw pluginError(
      403,
      "CHALLENGE_REQUIRED",
      "Approve this download in your browser.",
      {
        challengeToken: approvalToken,
        challengeUrl: `${origin}/plugin/challenge?code=${encodeURIComponent(challengeCode)}`,
        expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
      },
    );
  } catch (error) {
    return next(error);
  }
}
