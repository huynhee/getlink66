import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { scanMarketplaceDriveFolderBatch } from "./marketplaceDriveReconcileService.js";
import logger from "./logger.js";
import { writeSystemLog } from "./systemLog.js";

let timer = null;
let running = false;

function enabled() {
  return String(process.env.MARKETPLACE_DRIVE_RECONCILE_WORKER_ENABLED || "true").toLowerCase() === "true";
}

function intervalMs() {
  return Math.max(1000, Number(process.env.MARKETPLACE_DRIVE_RECONCILE_INTERVAL_MS || 2000));
}

function lockTimeoutMs() {
  return Math.max(60_000, Number(process.env.MARKETPLACE_DRIVE_RECONCILE_LOCK_TIMEOUT_MS || 15 * 60 * 1000));
}

function maxAttempts() {
  return Math.min(20, Math.max(1, Number(process.env.MARKETPLACE_DRIVE_RECONCILE_MAX_ATTEMPTS || 8)));
}

function retryAt(attempts) {
  const baseSeconds = Math.max(5, Number(process.env.MARKETPLACE_DRIVE_RECONCILE_RETRY_BASE_SECONDS || 30));
  const seconds = Math.min(60 * 60, baseSeconds * (2 ** Math.max(0, Number(attempts || 1) - 1)));
  return new Date(Date.now() + seconds * 1000);
}

function configuredRoot(assetType = "model") {
  const key = normalizeAssetType(assetType) === "scene"
    ? "SCENES_DRIVE_ROOT_FOLDER_ID"
    : "MARKETPLACE_DRIVE_ROOT_FOLDER_ID";
  return String(process.env[key] || "").trim();
}

export async function queueMarketplaceDriveReconciliation({
  assetType = "model",
  rootFolderId = "",
  batchSize = 100,
  reset = true,
} = {}) {
  const normalizedType = normalizeAssetType(assetType);
  const rootId = String(rootFolderId || configuredRoot(normalizedType)).trim();
  if (!rootId) {
    const error = new Error("Marketplace Drive root folder ID is required");
    error.status = 400;
    throw error;
  }
  const current = await MarketplaceDriveSyncState.findOne({ rootFolderId: rootId }).lean();
  if (["queued", "running"].includes(current?.reconciliationStatus)) {
    const error = new Error("Full Drive reconciliation is already running");
    error.status = 409;
    error.code = "MARKETPLACE_RECONCILIATION_ACTIVE";
    error.state = current;
    throw error;
  }
  if (["running", "error"].includes(current?.migrationStatus)) {
    const error = new Error("Marketplace metadata migration is active; reconciliation is locked");
    error.status = 423;
    error.code = "MARKETPLACE_MIGRATION_LOCKED";
    throw error;
  }
  const now = new Date();
  const safeBatchSize = Math.min(200, Math.max(1, Number(batchSize || 100)));
  const resetFields = reset ? {
    reconciliationPageToken: "",
    reconciliationScanned: 0,
    reconciliationCreated: 0,
    reconciliationUpdated: 0,
    reconciliationUnchanged: 0,
    reconciliationFailed: 0,
    reconciliationLastFailures: [],
  } : {};
  return MarketplaceDriveSyncState.findOneAndUpdate(
    { rootFolderId: rootId },
    {
      $setOnInsert: { rootFolderId: rootId, assetType: normalizedType },
      $set: {
        assetType: normalizedType,
        reconciliationStatus: "queued",
        reconciliationBatchSize: safeBatchSize,
        reconciliationAttempts: 0,
        reconciliationCancelRequested: false,
        reconciliationStartedAt: now,
        reconciliationFinishedAt: null,
        reconciliationLockedAt: null,
        reconciliationNextAttemptAt: now,
        reconciliationUpdatedAt: now,
        reconciliationError: "",
        ...resetFields,
      },
    },
    { upsert: true, new: true },
  );
}

export async function cancelMarketplaceDriveReconciliation({
  assetType = "model",
  rootFolderId = "",
} = {}) {
  const rootId = String(rootFolderId || configuredRoot(assetType)).trim();
  if (!rootId) {
    const error = new Error("Marketplace Drive root folder ID is required");
    error.status = 400;
    throw error;
  }
  return MarketplaceDriveSyncState.findOneAndUpdate(
    {
      rootFolderId: rootId,
      reconciliationStatus: { $in: ["queued", "running"] },
    },
    {
      $set: {
        reconciliationCancelRequested: true,
        reconciliationUpdatedAt: new Date(),
      },
    },
    { new: true },
  );
}

async function claimReconciliation() {
  const staleBefore = new Date(Date.now() - lockTimeoutMs());
  return MarketplaceDriveSyncState.findOneAndUpdate(
    {
      reconciliationCancelRequested: { $ne: true },
      reconciliationAttempts: { $lt: maxAttempts() },
      reconciliationNextAttemptAt: { $lte: new Date() },
      status: { $ne: "running" },
      $or: [
        { reconciliationStatus: "queued" },
        {
          reconciliationStatus: "running",
          reconciliationLockedAt: { $lt: staleBefore },
        },
      ],
    },
    {
      $set: {
        reconciliationStatus: "running",
        reconciliationLockedAt: new Date(),
        reconciliationUpdatedAt: new Date(),
        reconciliationError: "",
      },
      $inc: { reconciliationAttempts: 1 },
    },
    { new: true, sort: { reconciliationUpdatedAt: 1 } },
  );
}

async function finalizeCanceledJobs() {
  await MarketplaceDriveSyncState.updateMany(
    {
      reconciliationStatus: { $in: ["queued", "running"] },
      reconciliationCancelRequested: true,
    },
    {
      $set: {
        reconciliationStatus: "canceled",
        reconciliationFinishedAt: new Date(),
        reconciliationLockedAt: null,
        reconciliationUpdatedAt: new Date(),
      },
    },
  );
}

async function processClaimedState(state) {
  try {
    const result = await scanMarketplaceDriveFolderBatch({
      rootFolderId: state.rootFolderId,
      assetType: state.assetType,
      pageToken: state.reconciliationPageToken || "",
      limit: state.reconciliationBatchSize || 100,
    });
    const now = new Date();
    const latest = await MarketplaceDriveSyncState.findById(state._id)
      .select("reconciliationCancelRequested")
      .lean();
    const canceled = Boolean(latest?.reconciliationCancelRequested);
    const status = canceled ? "canceled" : result.hasMore ? "queued" : "complete";
    const updated = await MarketplaceDriveSyncState.findOneAndUpdate(
      {
        _id: state._id,
        reconciliationStatus: "running",
      },
      {
        $set: {
          reconciliationPageToken: result.nextPageToken || "",
          reconciliationStatus: status,
          reconciliationAttempts: 0,
          reconciliationLockedAt: null,
          reconciliationNextAttemptAt: now,
          reconciliationUpdatedAt: now,
          reconciliationError: "",
          reconciliationLastFailures: result.skipped.slice(0, 20),
          ...(!result.hasMore || canceled ? { reconciliationFinishedAt: now } : {}),
        },
        $inc: {
          reconciliationScanned: result.scannedFolders,
          reconciliationCreated: result.createdCount,
          reconciliationUpdated: result.updatedCount,
          reconciliationUnchanged: result.unchangedCount,
          reconciliationFailed: result.failedCount,
        },
      },
      { new: true },
    );
    logger.info({
      assetType: state.assetType,
      rootFolderId: state.rootFolderId,
      status,
      scanned: result.scannedFolders,
      created: result.createdCount,
      failed: result.failedCount,
    }, "Marketplace full Drive reconciliation batch finished");
    return updated;
  } catch (error) {
    const attempts = Number(state.reconciliationAttempts || 1);
    const exhausted = attempts >= maxAttempts();
    await MarketplaceDriveSyncState.findByIdAndUpdate(state._id, {
      $set: {
        reconciliationStatus: exhausted ? "error" : "queued",
        reconciliationLockedAt: null,
        reconciliationNextAttemptAt: retryAt(attempts),
        reconciliationUpdatedAt: new Date(),
        reconciliationError: String(error?.message || "drive_reconciliation_failed").slice(0, 500),
        ...(exhausted ? { reconciliationFinishedAt: new Date() } : {}),
      },
    });
    writeSystemLog({
      type: "system",
      level: exhausted ? "error" : "warning",
      message: "Marketplace full Drive reconciliation batch failed",
      details: {
        assetType: state.assetType,
        rootFolderId: state.rootFolderId,
        attempts,
        error: String(error?.message || ""),
      },
    }).catch(() => {});
    throw error;
  }
}

export async function runMarketplaceDriveReconcileTick() {
  if (running) return null;
  running = true;
  try {
    await finalizeCanceledJobs();
    const state = await claimReconciliation();
    if (!state) return null;
    return await processClaimedState(state);
  } finally {
    running = false;
  }
}

export function startMarketplaceDriveReconcileJob() {
  if (!enabled() || timer) return;
  const interval = intervalMs();
  timer = setInterval(() => {
    runMarketplaceDriveReconcileTick().catch((error) => {
      logger.warn({ err: error }, "Marketplace full reconciliation worker failed");
    });
  }, interval);
  timer.unref?.();
  setTimeout(() => {
    runMarketplaceDriveReconcileTick().catch((error) => {
      logger.warn({ err: error }, "Marketplace startup reconciliation failed");
    });
  }, 1000).unref?.();
  logger.info({ intervalMs: interval }, "Marketplace full reconciliation worker started");
}

export function stopMarketplaceDriveReconcileJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
