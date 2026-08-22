import crypto from "node:crypto";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import DownloadSession from "../models/DownloadSession.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { isMarketplaceAssetDeleted } from "./marketplaceDeletionService.js";
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
import { recordMarketplaceDownloadBehavior } from "./marketplaceBehaviorService.js";
import { downloadTokenSecret } from "../config/secrets.js";
import User from "../models/User.js";
import {
  ensureMarketplaceCreditEntitlement,
  getMarketplaceCreditEntitlement,
} from "./marketplaceCreditBillingService.js";
import { marketplaceCreditPrice } from "./marketplacePricingService.js";

const SESSION_TTL_MS = 15 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function deterministicSessionToken(sessionId, nonce) {
  return crypto
    .createHmac("sha256", downloadTokenSecret())
    .update(`3dipl-plugin-download:${sessionId}:${nonce}`)
    .digest("base64url");
}

function downloadSessionUrl(sessionId, token, clientType) {
  const prefix = clientType === "plugin"
    ? "/api/plugin/download/session"
    : "/api/download/session";
  return `${prefix}/${sessionId}/file?t=${encodeURIComponent(token)}`;
}

function requestIdempotencyKey(req, clientType) {
  const value = String(
    clientType === "plugin"
      ? req.get("idempotency-key")
      : (req.body?.clientRequestId || req.get?.("idempotency-key") || ""),
  ).trim();
  if (!value && clientType !== "plugin") return "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    const error = new Error("A valid idempotency key is required.");
    error.status = 400;
    error.code = "IDEMPOTENCY_KEY_REQUIRED";
    throw error;
  }
  return value;
}

function idempotencyScope(userId, clientType, key) {
  return key ? `${userId}:${clientType}:${key}` : "";
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

function legacyPaymentMethod(tier) {
  return tier === "member" ? "pro_quota" : "free_quota";
}

function paymentMethodError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  error.publicDetails = details;
  return error;
}

function resolvePaymentMethod({ requested, tier, model, assetType }) {
  const value = String(requested || legacyPaymentMethod(tier)).trim().toLowerCase();
  if (!new Set(["free_quota", "pro_quota", "credit"]).has(value)) {
    throw paymentMethodError(
      "PAYMENT_METHOD_NOT_ALLOWED",
      "The selected payment method is not supported.",
      400,
      { paymentMethod: value, assetType },
    );
  }
  if (value === "credit") return value;
  if (value === "pro_quota" && tier !== "member") {
    throw paymentMethodError(
      "PRO_REQUIRED",
      `Pro is required to download this ${assetType} with Pro quota.`,
      403,
      { assetType, upgradeUrl: "/topup?mode=pro" },
    );
  }
  if (value === "free_quota" && (tier !== "free" || model.accessType !== "free")) {
    if (!requested && model.accessType === "member") {
      throw paymentMethodError(
        "PRO_REQUIRED",
        `Pro is required to download this ${assetType} with quota.`,
        403,
        { assetType, upgradeUrl: "/topup?mode=pro" },
      );
    }
    throw paymentMethodError(
      "PAYMENT_METHOD_NOT_ALLOWED",
      "Free quota is not available for this download.",
      400,
      { paymentMethod: value, assetType },
    );
  }
  return value;
}

async function quotaSnapshot(req, tier) {
  const dayKey = vietnamDayKey();
  const quota = await DailyDownloadQuota.findOne({ dayKey, tier, userId: req.user._id, guestKey: "" }).lean();
  const limit = tierLimit(req, tier) + Number(quota?.bonusLimit || 0);
  const used = Number(quota?.count || 0);
  return {
    tier,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: nextVietnamReset(),
  };
}

async function loadDownloadableModel(modelId, expectedAssetType = "") {
  const model = await MarketplaceModel.findById(modelId);
  const assetType = normalizeAssetType(model?.assetType);
  const assetLabel = assetType === "scene" ? "Scene" : "Model";
  if (!model || isMarketplaceAssetDeleted(model) || !model.isPublished || (expectedAssetType && assetType !== normalizeAssetType(expectedAssetType))) {
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
  return { model, assetType };
}

export async function getMarketplaceDownloadOptions({ req, modelId, expectedAssetType = "" }) {
  if (!req.user) throw paymentMethodError("AUTH_REQUIRED", "Login is required.", 401);
  const { model, assetType } = await loadDownloadableModel(modelId, expectedAssetType);
  const tier = accessTier(req);
  const quotaCost = marketplaceDownloadCost(assetType);
  const [quota, creditPrice, entitlement, currentUser] = await Promise.all([
    quotaSnapshot(req, tier),
    marketplaceCreditPrice(assetType),
    getMarketplaceCreditEntitlement({ userId: req.user._id, assetType, assetId: model._id }),
    User.findById(req.user._id).select("credit proUntil proDailyDownloadLimit"),
  ]);
  const entitlementActive = Boolean(entitlement?.validUntil && new Date(entitlement.validUntil) > new Date());
  const quotaMethod = tier === "member" ? "pro_quota" : "free_quota";
  const quotaAllowed = tier === "member" || model.accessType === "free";
  const quotaAvailable = quotaAllowed && quota.remaining >= quotaCost;
  const creditBalance = Number(currentUser?.credit || 0);
  const creditEffectiveCost = entitlementActive ? 0 : creditPrice;
  const creditAvailable = entitlementActive || creditBalance >= creditPrice;
  const defaultMethod = entitlementActive
    ? "credit"
    : tier === "member"
      ? "pro_quota"
      : quotaAvailable
        ? "free_quota"
        : "credit";
  return {
    assetType,
    accessType: model.accessType,
    quotaCost,
    creditPrice,
    creditBalance,
    entitlementUntil: entitlementActive ? entitlement.validUntil : null,
    defaultMethod,
    quota,
    options: [
      {
        method: quotaMethod,
        available: quotaAvailable,
        cost: quotaCost,
        remaining: quota.remaining,
        reason: quotaAllowed ? (quotaAvailable ? "" : "DOWNLOAD_QUOTA_EXCEEDED") : "PRO_REQUIRED",
      },
      {
        method: "credit",
        available: creditAvailable,
        cost: creditEffectiveCost,
        configuredCost: creditPrice,
        balance: creditBalance,
        reason: creditAvailable ? "" : "INSUFFICIENT_CREDIT",
      },
    ],
  };
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
  if (req.user.isBanned) {
    const error = new Error(
      req.user.banReason || "This account cannot download marketplace assets.",
    );
    error.status = 403;
    error.code = "ACCOUNT_BANNED";
    throw error;
  }
  const normalizedClientType = clientType === "plugin" ? "plugin" : "web";
  const idempotencyKey = requestIdempotencyKey(req, normalizedClientType);
  const scope = idempotencyScope(req.user._id, normalizedClientType, idempotencyKey);
  if (idempotencyKey) {
    const existing = await DownloadSession.findOne({
      idempotencyScope: scope,
    });
    if (existing) {
      if (String(existing.modelId) !== String(modelId)) {
        const error = new Error("Idempotency-Key was already used for another asset.");
        error.status = 409;
        error.code = "IDEMPOTENCY_KEY_REUSED";
        throw error;
      }
      if (
        ["active", "used"].includes(existing.status)
        && new Date(existing.expiresAt) > new Date()
        && existing.pluginTokenNonce
      ) {
        const token = deterministicSessionToken(existing._id, existing.pluginTokenNonce);
        return {
          session: existing,
          token,
          downloadUrl: downloadSessionUrl(existing._id, token, normalizedClientType),
          remaining: Number(existing.quotaRemaining || 0),
          quotaCost: Number(existing.quotaCost || 0),
          resetAt: existing.quotaResetAt || null,
          paymentMethod: existing.paymentMethod,
          billingStatus: existing.billingStatus,
          creditCost: Number(existing.creditCost || 0),
          creditEntitlementUntil: existing.creditEntitlementUntil || null,
        };
      }
      const error = new Error("The idempotent download operation has expired.");
      error.status = 409;
      error.code = "IDEMPOTENCY_OPERATION_EXPIRED";
      throw error;
    }
  }
  const { model, assetType } = await loadDownloadableModel(modelId, expectedAssetType);
  const tier = accessTier(req);
  const paymentMethod = resolvePaymentMethod({
    requested: req.body?.paymentMethod,
    tier,
    model,
    assetType,
  });
  const quotaCost = marketplaceDownloadCost(assetType);
  let quota = {
    charged: false,
    cost: 0,
    remaining: 0,
    resetAt: nextVietnamReset(),
  };
  let creditCost = 0;
  let creditEntitlementUntil = null;
  if (paymentMethod === "credit") {
    const [price, entitlement, currentUser, currentQuota] = await Promise.all([
      marketplaceCreditPrice(assetType),
      getMarketplaceCreditEntitlement({ userId: req.user._id, assetType, assetId: model._id }),
      User.findById(req.user._id).select("credit"),
      quotaSnapshot(req, tier),
    ]);
    creditEntitlementUntil = entitlement?.validUntil || null;
    // Keep the configured price on the session as an immutable quote. The
    // billing step will change it to zero when an active entitlement is reused.
    creditCost = price;
    if (!creditEntitlementUntil && Number(currentUser?.credit || 0) < price) {
      throw paymentMethodError(
        "INSUFFICIENT_CREDIT",
        "Insufficient Credit for this download.",
        402,
        { balance: Number(currentUser?.credit || 0), required: price, topupUrl: "/topup?mode=credit" },
      );
    }
    quota.remaining = currentQuota.remaining;
    quota.resetAt = currentQuota.resetAt;
  } else {
    quota = await chargeQuota(req, tier, quotaCost);
  }
  const pluginTokenNonce = idempotencyKey || normalizedClientType === "plugin" ? makeToken() : "";
  let token = pluginTokenNonce ? "" : makeToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const purgeAt = new Date(expiresAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  let session = null;
  try {
    session = await DownloadSession.create({
      assetType,
      modelId: model._id,
      userId: req.user._id,
      guestKey: "",
      clientType: normalizedClientType,
      idempotencyKey,
      idempotencyScope: scope,
      pluginTokenNonce,
      tokenHash: token ? sha256(token) : "pending",
      expiresAt,
      purgeAt,
      status: "active",
      quotaCharged: quota.charged,
      quotaCost: quota.cost,
      paymentMethod,
      billingStatus: paymentMethod === "credit" ? "pending" : "not_applicable",
      creditCost,
      creditEntitlementUntil,
      accessTier: tier,
      storageProvider: model.storageProvider,
      storageKey: model.storageKey,
      driveFileId: model.driveFileId,
      fileName: safeDownloadFileName(model),
      fileSize: model.fileSize,
      sha256: model.sha256,
      assetRevision: String(model.contentRevision || `${model.sha256 || ""}:${Number(model.fileSize || 0)}`),
      mainMaxFile: String(model.mainMaxFile || ""),
      archiveFormat: safeArchiveExt(model.archiveExt),
      quotaRemaining: quota.remaining,
      quotaResetAt: quota.resetAt,
    });
    if (pluginTokenNonce) {
      token = deterministicSessionToken(session._id, pluginTokenNonce);
      session = await DownloadSession.findByIdAndUpdate(
        session._id,
        { $set: { tokenHash: sha256(token) } },
        { new: true },
      );
    }

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
      paymentMethod,
      billingStatus: paymentMethod === "credit" ? "pending" : "not_applicable",
      creditCost,
      creditEntitlementUntil,
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
    downloadUrl: downloadSessionUrl(session._id, token, normalizedClientType),
    remaining: quota.remaining,
    quotaCost: quota.cost,
    resetAt: quota.resetAt,
    paymentMethod,
    billingStatus: session.billingStatus,
    creditCost: Number(session.creditCost || 0),
    creditEntitlementUntil: session.creditEntitlementUntil || null,
  };
}

async function waitForCreditBilling(sessionId, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await DownloadSession.findById(sessionId);
    if (current && current.billingStatus !== "pending") return current;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw paymentMethodError(
    "CREDIT_BILLING_IN_PROGRESS",
    "Credit payment is still being processed. Please retry shortly.",
    409,
  );
}

async function syncDownloadBilling(session) {
  if (!session?._id) return;
  await ModelDownload.findOneAndUpdate(
    { sessionId: session._id },
    {
      $set: {
        billingStatus: session.billingStatus,
        creditCost: Number(session.creditCost || 0),
        creditTransactionId: String(session.creditTransactionId || ""),
        creditEntitlementUntil: session.creditEntitlementUntil || null,
      },
    },
  );
}

export async function finalizeMarketplaceDownloadBilling(session) {
  if (!session?._id || session.paymentMethod !== "credit") return session;
  const fresh = await DownloadSession.findById(session._id);
  if (!fresh) throw paymentMethodError("DOWNLOAD_SESSION_NOT_FOUND", "Download session not found.", 404);
  if (["charged", "reused"].includes(fresh.billingStatus)) {
    await syncDownloadBilling(fresh);
    return fresh;
  }

  const billingClaim = `pending:${crypto.randomUUID()}`;
  const claimed = await DownloadSession.findOneAndUpdate(
    {
      _id: fresh._id,
      billingStatus: "pending",
      $or: [{ creditTransactionId: "" }, { creditTransactionId: { $exists: false } }],
    },
    { $set: { creditTransactionId: billingClaim } },
    { new: true },
  );
  if (!claimed) return waitForCreditBilling(fresh._id);

  try {
    const model = await MarketplaceModel.findById(claimed.modelId)
      .select("assetType title slug source")
      .lean();
    if (!model) throw paymentMethodError("MARKETPLACE_ASSET_NOT_FOUND", "Marketplace asset not found.", 404);
    const configuredCost = Math.max(
      1,
      Math.floor(Number(claimed.creditCost || await marketplaceCreditPrice(claimed.assetType))),
    );
    const billing = await ensureMarketplaceCreditEntitlement({
      userId: claimed.userId,
      model,
      cost: configuredCost,
      operationId: `marketplace-download:${claimed._id}`,
    });
    const billingStatus = billing.charged ? "charged" : "reused";
    const actualCost = billing.charged ? configuredCost : 0;
    const transactionId = String(
      billing.ledger?._id
      || billing.entitlement?.lastTransactionId
      || `entitlement:${billing.entitlement?._id || ""}`,
    );
    const entitlementUntil = billing.entitlement?.validUntil || null;
    const update = {
      billingStatus,
      creditCost: actualCost,
      creditTransactionId: transactionId,
      creditEntitlementUntil: entitlementUntil,
    };
    const updated = await DownloadSession.findOneAndUpdate(
      { _id: claimed._id, billingStatus: "pending", creditTransactionId: billingClaim },
      { $set: update },
      { new: true },
    );
    if (!updated) return waitForCreditBilling(claimed._id);
    await syncDownloadBilling(updated);
    return updated;
  } catch (error) {
    await DownloadSession.findOneAndUpdate(
      { _id: claimed._id, billingStatus: "pending", creditTransactionId: billingClaim },
      { $set: { creditTransactionId: "" } },
    ).catch(() => {});
    throw error;
  }
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
    {
      $inc: { downloadCount: 1, popularity24h: 1 },
      $set: {
        popularity24hUpdatedAt: now,
        searchEngineStatus: "pending",
        searchEngineError: "",
      },
    },
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
    if (result.counted) {
      invalidateMarketplaceHomeRecommendations(session.userId);
      recordMarketplaceDownloadBehavior(session).catch(() => {});
    }
    return result;
  }
  const databaseSession = await marketplaceDbConnection().startSession();
  let result;
  try {
    await databaseSession.withTransaction(async () => {
      result = await markRedeemedWithSession(session, databaseSession);
    });
    if (result?.counted) {
      invalidateMarketplaceHomeRecommendations(session.userId);
      recordMarketplaceDownloadBehavior(session).catch(() => {});
    }
    return result;
  } finally {
    await databaseSession.endSession();
  }
}

export async function verifyDownloadSession(sessionId, token, expectedUserId = "") {
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
  if (
    expectedUserId
    && String(session.userId || "") !== String(expectedUserId)
  ) {
    const error = new Error("This download session belongs to another account");
    error.status = 403;
    error.code = "DOWNLOAD_SESSION_OWNER_MISMATCH";
    throw error;
  }
  return session;
}
