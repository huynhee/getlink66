import crypto from "node:crypto";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import DownloadSession from "../models/DownloadSession.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import { isProActive } from "./membershipService.js";
import { marketplaceDownloadCost, normalizeAssetType } from "../data/marketplaceCatalogs.js";

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

export function vietnamDayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextVietnamReset(date = new Date()) {
  const [year, month, day] = vietnamDayKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 17, 0, 0, 0));
}

function guestKeyFromReq(req) {
  const ua = String(req.get("user-agent") || "").slice(0, 160);
  const ip = String(req.ip || "");
  return sha256(`${ip}|${ua}`).slice(0, 40);
}

function accessTier(req) {
  if (req.user?.role === "admin") return "admin";
  if (req.user && isProActive(req.user)) return "member";
  if (req.user) return "free";
  return "guest";
}

function tierLimit(req, tier) {
  if (tier === "admin") return Number.MAX_SAFE_INTEGER;
  if (tier === "member") return Number(req.user?.proDailyDownloadLimit || 100);
  if (tier === "free") return 10;
  return 5;
}

function canAccessModel(model, tier) {
  if (tier === "admin") return true;
  if (model.accessType === "free") return true;
  if (model.accessType === "member") return tier === "member";
  return false;
}

async function chargeQuota(req, tier, cost = 1) {
  const quotaCost = Math.max(1, Math.floor(Number(cost || 1)));
  if (tier === "admin") return { charged: false, cost: 0, remaining: Number.MAX_SAFE_INTEGER };
  const dayKey = vietnamDayKey();
  const resetAt = nextVietnamReset();
  const identity = req.user
    ? { userId: req.user._id, guestKey: "" }
    : { guestKey: guestKeyFromReq(req) };
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
  if (tier === "admin") return;
  const identity = req.user
    ? { userId: req.user._id, guestKey: "" }
    : { guestKey: guestKeyFromReq(req) };
  await DailyDownloadQuota.findOneAndUpdate(
    { dayKey: vietnamDayKey(), tier, ...identity, count: { $gt: 0 } },
    { $inc: { count: -Math.max(1, Math.floor(Number(cost || 1))) } },
    { new: true },
  ).catch(() => {});
}

export async function createMarketplaceDownloadSession({ req, modelId, clientType = "web", expectedAssetType = "" }) {
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
    const error = new Error(`Your account cannot download this ${assetType}.`);
    error.status = 403;
    throw error;
  }

  const quota = await chargeQuota(req, tier, marketplaceDownloadCost(assetType));
  const token = makeToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  let session = null;
  try {
    session = await DownloadSession.create({
      assetType,
      modelId: model._id,
      userId: req.user?._id,
      guestKey: req.user ? "" : guestKeyFromReq(req),
      clientType: clientType === "plugin" ? "plugin" : "web",
      tokenHash: sha256(token),
      expiresAt,
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
      userId: req.user?._id,
      guestKey: req.user ? "" : guestKeyFromReq(req),
      clientType: session.clientType,
      accessTier: tier,
      quotaCharged: quota.charged,
      quotaCost: quota.cost,
      ip: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
    });
  } catch (error) {
    if (session?._id) await DownloadSession.findByIdAndDelete(session._id).catch(() => {});
    if (quota.charged) await rollbackQuota(req, tier, quota.cost);
    throw error;
  }
  await MarketplaceModel.findByIdAndUpdate(model._id, { $inc: { downloadCount: 1 } }).catch(() => {});

  return {
    session,
    token,
    downloadUrl: `/api/download/session/${session._id}/file?t=${encodeURIComponent(token)}`,
    remaining: quota.remaining,
    quotaCost: quota.cost,
    resetAt: quota.resetAt,
  };
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
