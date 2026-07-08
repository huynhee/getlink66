import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import { scanMarketplaceDriveFolderBatch } from "../controllers/marketplaceAdminController.js";
import logger from "./logger.js";
import { writeSystemLog } from "./systemLog.js";

let syncRunning = false;
let syncTimer = null;

function syncEnabled() {
  return String(process.env.MARKETPLACE_DRIVE_SYNC_ENABLED || "false").toLowerCase() === "true";
}

function syncRootFolderId() {
  return String(process.env.MARKETPLACE_DRIVE_ROOT_FOLDER_ID || "").trim();
}

function syncBatchSize() {
  const value = Number(process.env.MARKETPLACE_DRIVE_SYNC_BATCH_SIZE || 50);
  return Math.min(200, Math.max(1, Number.isFinite(value) ? Math.round(value) : 50));
}

function syncIntervalMs() {
  const minutes = Number(process.env.MARKETPLACE_DRIVE_SYNC_INTERVAL_MINUTES || 30);
  return Math.max(1, Number.isFinite(minutes) ? minutes : 30) * 60 * 1000;
}

export function marketplaceDriveSyncConfig() {
  return {
    enabled: syncEnabled(),
    rootFolderId: syncRootFolderId(),
    batchSize: syncBatchSize(),
    intervalMinutes: Math.round(syncIntervalMs() / 60000),
  };
}

export async function getMarketplaceDriveSyncState() {
  const rootFolderId = syncRootFolderId();
  if (!rootFolderId) return null;
  return MarketplaceDriveSyncState.findOne({ rootFolderId }).lean();
}

export async function runMarketplaceDriveSyncOnce({ trigger = "interval", rootFolderId = "" } = {}) {
  const folderId = String(rootFolderId || "").trim() || syncRootFolderId();
  if (!folderId) {
    const error = new Error("MARKETPLACE_DRIVE_ROOT_FOLDER_ID is not configured");
    error.status = 400;
    throw error;
  }
  if (syncRunning) {
    const error = new Error("Marketplace Drive sync is already running");
    error.status = 409;
    throw error;
  }

  syncRunning = true;
  const startedAt = new Date();
  let state = null;
  try {
    state = await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId: folderId },
      {
        $setOnInsert: { rootFolderId: folderId },
        $set: { status: "running", lastStartedAt: startedAt, lastError: "" },
      },
      { upsert: true, new: true },
    );

    const result = await scanMarketplaceDriveFolderBatch({
      rootFolderId: folderId,
      pageToken: state.pageToken || "",
      limit: syncBatchSize(),
      // Sync tu dong khong ghi de accessType/publish mac dinh cua batch thu cong:
      // folder khong doi -> unchanged, folder doi -> doc metadata tu Drive.
      defaultAccessType: "member",
      isPublished: true,
    });

    const cycleCompleted = !result.nextPageToken;
    const update = {
      $set: {
        status: "idle",
        pageToken: result.nextPageToken || "",
        lastFinishedAt: new Date(),
        lastError: "",
        lastBatchCreated: Number(result.createdCount || 0),
        lastBatchUpdated: Number(result.updatedCount || 0),
        lastBatchUnchanged: Number(result.unchangedCount || 0),
      },
      $inc: {
        createdCount: Number(result.createdCount || 0),
        updatedCount: Number(result.updatedCount || 0),
        unchangedCount: Number(result.unchangedCount || 0),
        ...(cycleCompleted ? { cycleCount: 1 } : {}),
      },
    };
    if (cycleCompleted) update.$set.lastCycleCompletedAt = new Date();
    const nextState = await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId: folderId },
      update,
      { new: true },
    );

    logger.info(
      {
        trigger,
        rootFolderId: folderId,
        scannedFolders: result.scannedFolders,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        unchangedCount: result.unchangedCount,
        cycleCompleted,
      },
      "Marketplace Drive sync batch finished",
    );

    return { result, state: nextState?.toObject ? nextState.toObject() : nextState, cycleCompleted };
  } catch (error) {
    await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId: folderId },
      {
        $setOnInsert: { rootFolderId: folderId },
        $set: {
          status: "error",
          lastFinishedAt: new Date(),
          lastError: String(error?.message || "drive_sync_failed").slice(0, 500),
        },
      },
      { upsert: true },
    ).catch(() => {});
    writeSystemLog({
      type: "system",
      level: "error",
      message: "Marketplace Drive sync failed",
      details: { trigger, rootFolderId: folderId, error: String(error?.message || "") },
    }).catch(() => {});
    throw error;
  } finally {
    syncRunning = false;
  }
}

export function startMarketplaceDriveSyncJob() {
  if (!syncEnabled()) {
    logger.info("Marketplace Drive sync job is disabled");
    return;
  }
  if (!syncRootFolderId()) {
    logger.warn("Marketplace Drive sync enabled but MARKETPLACE_DRIVE_ROOT_FOLDER_ID is empty");
    return;
  }
  if (syncTimer) return;
  const interval = syncIntervalMs();
  syncTimer = setInterval(() => {
    runMarketplaceDriveSyncOnce({ trigger: "interval" }).catch((error) => {
      logger.error({ err: error }, "Marketplace Drive sync interval run failed");
    });
  }, interval);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
  logger.info({ intervalMinutes: Math.round(interval / 60000) }, "Marketplace Drive sync job started");
}

export function stopMarketplaceDriveSyncJob() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
