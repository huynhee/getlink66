import crypto from "node:crypto";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import DownloadSession from "../models/DownloadSession.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import {
  isProActive,
  nextVietnamReset,
  vietnamDayKey,
} from "./membershipService.js";
import { marketplaceDownloadCost, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceDbConnection } from "../config/db.js";
import { invalidateMarketplaceHomeRecommendations } from "./marketplaceRecommendationService.js";

const SESSION_TTL_MS = 15 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function safeArchiveExt(value = "") {
  const ext = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["zip", "rar", "7z"].includes(ext) ? ext : "zip";
}

function safeDownloadFileName(model) {
  const fallbackName = normalizeAssetType(model.assetType) === "scene" ? "scene" : "model";
  const base = String(model.slug || model.title || fallbackName)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallbackName;
  return `${base}.${safeArchiveExt(model.archiveExt)}`;
}

export { nextVietnamReset, vietnamDayKey };

function accessTier(req) {
  if (req.user && isProActive(req.user)) return "member";
  return "free";
}

function tierLimit(req, tier) {
  if (tier === "member") return Number(req.user?.proDailyDownloadLimit || 100);
  return 5;
}

function canAccessModel(model, tier) {
  if (model.accessType === "free") return true;
  if (model.accessType === "member") return tier === "member";
  return false;
}

async function chargeQuota(req, tier, cost = 1) {
  const quotaCost = Math.max(1, Math.floor(Number(cost || 1)));
  const dayKey = vietnamDayKey();
  const resetAt = nextVietnamReset();
  const identity = { userId: req.user._id, guestKey: "" };
  const query = { dayKey, tier, ...identity };
  let current = await DailyDownloadQuota.findOne(query);
  if (!current) {
    try {
      current = await DailyDownloadQuota.findOneAndUpdate(
        query,
        { $setOnInsert: { ...query, count: 0, resetAt } },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      current = await DailyDownloadQuota.findOne(query);
    }
  }
  const limit = tierLimit(req, tier) + Number(current?.bonusLimit || 0);
  const remainingBefore = Math.max(0, limit - Number(current?.count || 0));
  if (remainingBefore < quotaCost) {
    const error = new Error(`Daily download quota exceeded for ${tier}.`);
    error.status = 429;
    error.details = { limit, required: quotaCost, remaining: remainingBefore, resetAt };
    error.publicDetails = error.details;
    error.code = "DOWNLOAD_QUOTA_EXCEEDED";
    throw error;
  }
  const quota = await DailyDownloadQuota.findOneAndUpdate(
    { ...query, count: { $lte: limit - quotaCost } },
    { $inc: { count: quotaCost } },
    { new: true },
  );

  if (!quota) {
    const latest = await DailyDownloadQuota.findOne(query);
    const error = new Error(`Daily download quota exceeded for ${tier}.`);
    error.status = 429;
    error.details = {
      limit,
      required: quotaCost,
      remaining: Math.max(0, limit - Number(latest?.count || 0)),
      resetAt,
    };
    error.publicDetails = error.details;
    error.code = "DOWNLOAD_QUOTA_EXCEEDED";
    throw error;
  }

  return {
    charged: true,
    cost: quotaCost,
    remaining: Math.max(0, limit - Number(quota.count || 0)),
    resetAt,
  };
}

async function rollbackQuota(req, tier, cost = 1) {
  const quotaCost = Math.max(1, Math.floor(Number(cost || 1)));
  const identity = { userId: req.user._id, guestKey: "" };
  await DailyDownloadQuota.findOneAndUpdate(
    { dayKey: vietnamDayKey(), tier, ...identity, count: { $gte: quotaCost } },
    { $inc: { count: -quotaCost } },
    { new: true },
  ).catch(() => {});
}

export async function createMarketplaceDownloadSession({ req, modelId, clientType = "web", expectedAssetType = "" }) {
  if (!req.user) {
    const error = new Error("Login is required to download marketplace assets.");
    error.status = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  const model = await MarketplaceModel.findById(modelId);
  const assetType = normalizeAssetType(model?.assetType);
  const assetLabel = assetType === "scene" ? "Scene" : "Model";
  if (!model || !model.isPublished || (expectedAssetType && assetType !== normalizeAssetType(expectedAssetType))) {
    const error = new Error("Marketplace asset not found");
    error.status = 404;
    throw error;
  }
  if (model.metadataStatus !== "complete") {
    const error = new Error(`${assetLabel} metadata is not complete yet.`);
    error.status = 409;
    throw error;
  }
  if (model.fileStatus !== "ready") {
    const error = new Error(`${assetLabel} file is not ready yet.`);
    error.status = 409;
    throw error;
  }
  if (model.source?.provider === "demo") {
    const error = new Error(`${assetLabel} mẫu chỉ dùng để kiểm tra giao diện, không có file tải.`);
    error.status = 409;
    throw error;
  }

  const tier = accessTier(req);
  if (!canAccessModel(model, tier)) {
    const error = new Error(`Pro is required to download this ${assetType}.`);
    error.status = 403;
    error.code = "PRO_REQUIRED";
    error.details = { assetType, upgradeUrl: "/topup?mode=pro" };
    error.publicDetails = error.details;
    throw error;
  }

  const quota = await chargeQuota(req, tier, marketplaceDownloadCost(assetType));
  const token = makeToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const purgeAt = new Date(expiresAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  let session = null;
  try {
    session = await DownloadSession.create({
      assetType,
      modelId: model._id,
      userId: req.user._id,
      guestKey: "",
      clientType: clientType === "plugin" ? "plugin" : "web",
      tokenHash: sha256(token),
      expiresAt,
      purgeAt,
      status: "active",
      quotaCharged: quota.charged,
      quotaCost: quota.cost,
      accessTier: tier,
      storageProvider: model.storageProvider,
      storageKey: model.storageKey,
      driveFileId: model.driveFileId,
      fileName: safeDownloadFileName(model),
      fileSize: model.fileSize,
      sha256: model.sha256,
    });

    await ModelDownload.create({
      assetType,
      modelId: model._id,
      sessionId: session._id,
      userId: req.user._id,
      guestKey: "",
      clientType: session.clientType,
      accessTier: tier,
      quotaCharged: quota.charged,
      quotaCost: quota.cost,
      status: "requested",
      ip: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
    });
  } catch (error) {
    if (session?._id) await DownloadSession.findByIdAndDelete(session._id).catch(() => {});
    if (quota.charged) await rollbackQuota(req, tier, quota.cost);
    throw error;
  }
  return {
    session,
    token,
    downloadUrl: `/api/download/session/${session._id}/file?t=${encodeURIComponent(token)}`,
    remaining: quota.remaining,
    quotaCost: quota.cost,
    resetAt: quota.resetAt,
  };
}

async function markRedeemedWithSession(session, databaseSession = null) {
  const now = new Date();
  const options = { new: true, ...(databaseSession ? { session: databaseSession } : {}) };
  const claimed = await DownloadSession.findOneAndUpdate(
    {
      _id: session._id,
      status: { $in: ["active", "used"] },
      $or: [
        { downloadCountedAt: null },
        { downloadCountedAt: { $exists: false } },
      ],
    },
    {
      $set: {
        status: "used",
        downloadedAt: now,
        downloadCountedAt: now,
      },
    },
    options,
  );
  if (!claimed) {
    await DownloadSession.findByIdAndUpdate(
      session._id,
      { $set: { status: "used", downloadedAt: session.downloadedAt || now } },
      databaseSession ? { session: databaseSession } : undefined,
    );
    return { counted: false, session };
  }
  await ModelDownload.findOneAndUpdate(
    { sessionId: session._id },
    { $set: { status: "downloaded", downloadedAt: now } },
    options,
  );
  await MarketplaceModel.findByIdAndUpdate(
    session.modelId,
    { $inc: { downloadCount: 1 } },
    databaseSession ? { session: databaseSession } : undefined,
  );
  return { counted: true, session: claimed };
}

export async function markMarketplaceDownloadRedeemed(session) {
  if (!session?._id) {
    const error = new Error("Download session is required");
    error.status = 400;
    throw error;
  }
  if (isMemoryDb()) {
    const result = await markRedeemedWithSession(session);
    if (result.counted) invalidateMarketplaceHomeRecommendations(session.userId);
    return result;
  }
  const databaseSession = await marketplaceDbConnection().startSession();
  let result;
  try {
    await databaseSession.withTransaction(async () => {
      result = await markRedeemedWithSession(session, databaseSession);
    });
    if (result?.counted) invalidateMarketplaceHomeRecommendations(session.userId);
    return result;
  } finally {
    await databaseSession.endSession();
  }
}

export async function verifyDownloadSession(sessionId, token) {
  const session = await DownloadSession.findById(sessionId);
  // "used" van duoc phep tai lai trong TTL: download manager/browser co the mo
  // nhieu ket noi hoac retry; quota da duoc tinh khi tao session, khong tinh lai.
  if (!session || !["active", "used"].includes(session.status)) {
    const error = new Error("Download session not found");
    error.status = 404;
    throw error;
  }
  if (new Date(session.expiresAt) <= new Date()) {
    await DownloadSession.findByIdAndUpdate(session._id, { status: "expired" });
    const error = new Error("Download session expired");
    error.status = 410;
    throw error;
  }
  if (sha256(token || "") !== session.tokenHash) {
    const error = new Error("Invalid download token");
    error.status = 403;
    throw error;
  }
  return session;
}
