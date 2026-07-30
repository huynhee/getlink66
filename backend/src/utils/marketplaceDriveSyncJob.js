import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import {
  getGoogleDriveAuthStatus,
  getGoogleDriveFileMetadata,
  getGoogleDriveStartPageToken,
  listGoogleDriveChanges,
} from "./storageProvider.js";
import {
  markMarketplaceDriveModelMissing,
  syncMarketplaceDriveFolder,
} from "./marketplaceDriveService.js";
import logger from "./logger.js";
import { writeSystemLog } from "./systemLog.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

let syncRunning = false;
let syncTimer = null;
let initialSyncTimer = null;
const SYNC_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

function syncEnabled() {
  return String(process.env.MARKETPLACE_DRIVE_CHANGES_ENABLED || "false").toLowerCase() === "true";
}

function rootFolderId(assetType = "model") {
  const key = normalizeAssetType(assetType) === "scene"
    ? "SCENES_DRIVE_ROOT_FOLDER_ID"
    : "MARKETPLACE_DRIVE_ROOT_FOLDER_ID";
  return String(process.env[key] || "").trim();
}

function configuredRoots() {
  return ["model", "scene"]
    .map((assetType) => ({ assetType, rootFolderId: rootFolderId(assetType) }))
    .filter((item) => item.rootFolderId);
}

function assetTypeForRoot(rootId) {
  return configuredRoots().find((item) => item.rootFolderId === String(rootId || "").trim())?.assetType || "model";
}

function changeBatchSize() {
  return Math.min(1000, Math.max(1, Number(process.env.MARKETPLACE_DRIVE_CHANGES_BATCH_SIZE || 100)));
}

function queueBatchSize() {
  return Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_DRIVE_QUEUE_BATCH_SIZE || 20)));
}

function maxAttempts() {
  return Math.min(20, Math.max(1, Number(process.env.MARKETPLACE_DRIVE_QUEUE_MAX_ATTEMPTS || 8)));
}

function pollIntervalMs() {
  return Math.max(30, Number(process.env.MARKETPLACE_DRIVE_CHANGES_POLL_SECONDS || 120)) * 1000;
}

function retryDate(attempts) {
  const baseSeconds = Math.max(5, Number(process.env.MARKETPLACE_DRIVE_QUEUE_RETRY_BASE_SECONDS || 30));
  const delay = Math.min(60 * 60, baseSeconds * (2 ** Math.max(0, Number(attempts || 1) - 1)));
  return new Date(Date.now() + delay * 1000);
}

export function marketplaceDriveSyncConfig() {
  return {
    enabled: syncEnabled(),
    rootFolderId: rootFolderId(),
    roots: configuredRoots(),
    mode: "changes",
    pollSeconds: Math.round(pollIntervalMs() / 1000),
    changesBatchSize: changeBatchSize(),
    queueBatchSize: queueBatchSize(),
    maxAttempts: maxAttempts(),
    writeEnabled: String(process.env.MARKETPLACE_DRIVE_WRITE_ENABLED || "false").toLowerCase() === "true",
    auth: getGoogleDriveAuthStatus(),
  };
}

export async function getMarketplaceDriveSyncState(assetType = "model") {
  const rootId = rootFolderId(assetType);
  if (!rootId) return null;
  return MarketplaceDriveSyncState.findOne({ rootFolderId: rootId }).lean();
}

async function findModelByDriveItem(fileId, assetType = "model") {
  return MarketplaceModel.findOne({
    assetType: normalizeAssetType(assetType),
    $or: [
      { driveFolderId: fileId },
      { driveFileId: fileId },
      { metadataDriveFileId: fileId },
      { "coverImage.driveFileId": fileId },
      { "previewImages.driveFileId": fileId },
    ],
  }).lean();
}

async function resolveChangedFolder(change, rootId, assetType = "model") {
  const file = change.file || {};
  if (file.mimeType === "application/vnd.google-apps.folder" && (file.parents || []).includes(rootId)) {
    return file.id || change.fileId;
  }
  const known = await findModelByDriveItem(change.fileId, assetType);
  if (known?.driveFolderId) return known.driveFolderId;
  const parents = Array.isArray(file.parents) ? file.parents : [];
  if (parents.length) {
    const parentModel = await MarketplaceModel.findOne({ assetType: normalizeAssetType(assetType), driveFolderId: { $in: parents } }).select("driveFolderId").lean();
    if (parentModel?.driveFolderId) return parentModel.driveFolderId;
  }
  for (const parentId of parents.slice(0, 2)) {
    const parent = await getGoogleDriveFileMetadata(parentId, {
      fields: "id,mimeType,parents,trashed,driveId",
    }).catch(() => null);
    if (parent && !parent.trashed && parent.mimeType === "application/vnd.google-apps.folder" && (parent.parents || []).includes(rootId)) {
      return parent.id;
    }
  }
  return "";
}

async function enqueueFolderChange({ rootId, folderId, change, assetType = "model" }) {
  if (!folderId) return false;
  const reason = change.removed || change.file?.trashed ? "removed" : "changed";
  const changedFileId = String(change.fileId || change.file?.id || "").trim();
  const update = {
    $setOnInsert: { rootFolderId: rootId, driveFolderId: folderId, assetType: normalizeAssetType(assetType) },
    $set: {
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lastError: "",
      latestChangeAt: change.time ? new Date(change.time) : new Date(),
    },
    $inc: { generation: 1 },
    $addToSet: { reasons: reason },
  };
  if (changedFileId) update.$addToSet.changedFileIds = changedFileId;
  await MarketplaceDriveChange.findOneAndUpdate(
    { rootFolderId: rootId, driveFolderId: folderId },
    update,
    { upsert: true, new: true },
  );
  return true;
}

async function initializeChangesToken(state, rootMeta, assetType = "model") {
  if (state?.changesPageToken) return state;
  const token = await getGoogleDriveStartPageToken({ driveId: rootMeta.driveId || "" });
  return MarketplaceDriveSyncState.findOneAndUpdate(
    { rootFolderId: rootMeta.id },
    {
      $setOnInsert: { rootFolderId: rootMeta.id, assetType: normalizeAssetType(assetType) },
      $set: {
        changesPageToken: token,
        changesInitializedAt: new Date(),
        lastChangesError: "",
      },
    },
    { upsert: true, new: true },
  );
}

export async function pollMarketplaceDriveChanges({ rootId = "" } = {}) {
  const normalizedRootId = String(rootId || rootFolderId()).trim();
  if (!normalizedRootId) {
    const error = new Error("MARKETPLACE_DRIVE_ROOT_FOLDER_ID is not configured");
    error.status = 400;
    throw error;
  }
  const rootMeta = await getGoogleDriveFileMetadata(normalizedRootId, {
    fields: "id,name,mimeType,driveId,trashed,parents",
  });
  const assetType = assetTypeForRoot(normalizedRootId);
  let state = await MarketplaceDriveSyncState.findOne({ rootFolderId: normalizedRootId });
  state = await initializeChangesToken(state, rootMeta, assetType);
  const response = await listGoogleDriveChanges(state.changesPageToken, {
    pageSize: changeBatchSize(),
    driveId: rootMeta.driveId || "",
  });
  let queued = 0;
  for (const change of response.changes || []) {
    if (change.changeType && change.changeType !== "file") continue;
    const folderId = await resolveChangedFolder(change, normalizedRootId, assetType);
    if (await enqueueFolderChange({ rootId: normalizedRootId, folderId, change, assetType })) queued += 1;
  }
  const nextToken = response.nextPageToken || response.newStartPageToken || state.changesPageToken;
  state = await MarketplaceDriveSyncState.findOneAndUpdate(
    { rootFolderId: normalizedRootId },
    {
      $set: {
        changesPageToken: nextToken,
        lastChangesPollAt: new Date(),
        lastChangesError: "",
        lastChangesCount: (response.changes || []).length,
        queuedChangesCount: await MarketplaceDriveChange.countDocuments({ rootFolderId: normalizedRootId }),
      },
    },
    { new: true },
  );
  return { changes: (response.changes || []).length, queued, hasMore: Boolean(response.nextPageToken), state };
}

async function claimQueueItem(rootId) {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  return MarketplaceDriveChange.findOneAndUpdate(
    {
      rootFolderId: rootId,
      attempts: { $lt: maxAttempts() },
      nextAttemptAt: { $lte: new Date() },
      $or: [
        { status: { $in: ["pending", "failed"] } },
        { status: "processing", lockedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { status: "processing", lockedAt: new Date(), lastError: "" },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { updatedAt: 1 } },
  );
}

export async function processMarketplaceDriveChangeQueue({ rootId = "", limit = queueBatchSize() } = {}) {
  const normalizedRootId = String(rootId || rootFolderId()).trim();
  const assetType = assetTypeForRoot(normalizedRootId);
  let processed = 0;
  let failed = 0;
  const results = [];
  for (let index = 0; index < Math.min(queueBatchSize(), Math.max(1, Number(limit || 1))); index += 1) {
    const item = await claimQueueItem(normalizedRootId);
    if (!item) break;
    try {
      const result = await syncMarketplaceDriveFolder({ driveFolderId: item.driveFolderId, force: true, assetType: item.assetType || assetType });
      const removed = await MarketplaceDriveChange.deleteOne({
        _id: item._id,
        status: "processing",
        generation: item.generation,
      });
      processed += 1;
      results.push({
        folderId: item.driveFolderId,
        status: removed.deletedCount ? "synced" : "rescheduled",
        action: result.action,
      });
    } catch (error) {
      if (error?.code === "MARKETPLACE_ASSET_DELETED") {
        await MarketplaceDriveChange.deleteOne({ _id: item._id });
        processed += 1;
        results.push({ folderId: item.driveFolderId, status: "ignored_deleted" });
        continue;
      }
      if (error?.status === 404) {
        const model = await MarketplaceModel.findOne({ assetType: item.assetType || assetType, driveFolderId: item.driveFolderId }).lean();
        if (model && (!model.deletionStatus || model.deletionStatus === "active")) {
          await markMarketplaceDriveModelMissing(model, error.message);
        }
        await MarketplaceDriveChange.deleteOne({ _id: item._id });
        processed += 1;
        results.push({ folderId: item.driveFolderId, status: "missing" });
        continue;
      }
      failed += 1;
      await MarketplaceDriveChange.findByIdAndUpdate(item._id, {
        $set: {
          status: "failed",
          lockedAt: null,
          lastError: String(error?.message || "drive_sync_failed").slice(0, 500),
          nextAttemptAt: retryDate(item.attempts),
        },
      });
      results.push({ folderId: item.driveFolderId, status: "failed", error: error?.message || "drive_sync_failed" });
    }
  }
  await MarketplaceDriveSyncState.findOneAndUpdate(
    { rootFolderId: normalizedRootId },
    { $set: { queuedChangesCount: await MarketplaceDriveChange.countDocuments({ rootFolderId: normalizedRootId }) } },
  );
  return { processed, failed, results };
}

async function claimSyncState(rootId, assetType = "model") {
  const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS);
  let state = await MarketplaceDriveSyncState.findOneAndUpdate(
    {
      rootFolderId: rootId,
      $or: [
        { status: { $ne: "running" } },
        { lastStartedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { status: "running", lastStartedAt: new Date(), lastError: "" },
      $setOnInsert: { rootFolderId: rootId, assetType: normalizeAssetType(assetType) },
    },
    { new: true },
  );
  if (state) return state;
  try {
    state = await MarketplaceDriveSyncState.create({
      rootFolderId: rootId,
      assetType: normalizeAssetType(assetType),
      status: "running",
      lastStartedAt: new Date(),
    });
    return state;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const conflict = new Error("Marketplace Drive changes sync is already running in another process");
    conflict.status = 409;
    throw conflict;
  }
}

export async function runMarketplaceDriveSyncOnce({ trigger = "interval", rootFolderId: requestedRootId = "" } = {}) {
  const rootId = String(requestedRootId || rootFolderId()).trim();
  const assetType = assetTypeForRoot(rootId);
  if (!rootId) {
    const error = new Error("MARKETPLACE_DRIVE_ROOT_FOLDER_ID is not configured");
    error.status = 400;
    throw error;
  }
  if (syncRunning) {
    const error = new Error("Marketplace Drive changes sync is already running");
    error.status = 409;
    throw error;
  }
  const migration = await MarketplaceDriveSyncState.findOne({ rootFolderId: rootId }).select("migrationStatus").lean();
  if (["running", "error"].includes(migration?.migrationStatus)) {
    const error = new Error("Marketplace metadata migration is active; Drive Changes sync is locked.");
    error.status = 423;
    error.code = "MARKETPLACE_MIGRATION_LOCKED";
    throw error;
  }
  const reconciliation = await MarketplaceDriveSyncState.findOne({ rootFolderId: rootId })
    .select("reconciliationStatus")
    .lean();
  if (["queued", "running"].includes(reconciliation?.reconciliationStatus)) {
    const error = new Error("Full Drive reconciliation is active; Changes sync will resume after it finishes.");
    error.status = 423;
    error.code = "MARKETPLACE_RECONCILIATION_ACTIVE";
    throw error;
  }
  syncRunning = true;
  try {
    await claimSyncState(rootId, assetType);
    const poll = await pollMarketplaceDriveChanges({ rootId });
    const queue = await processMarketplaceDriveChangeQueue({ rootId });
    const state = await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId: rootId },
      { $set: { status: "idle", lastFinishedAt: new Date(), lastError: "" } },
      { new: true },
    );
    logger.info({ trigger, assetType, rootFolderId: rootId, ...poll, processed: queue.processed, failed: queue.failed }, "Marketplace Drive changes sync finished");
    return {
      result: {
        scannedFolders: queue.processed,
        createdCount: queue.results.filter((item) => item.action === "created").length,
        updatedCount: queue.results.filter((item) => item.action === "updated").length,
        unchangedCount: queue.results.filter((item) => item.action === "unchanged").length,
        changesCount: poll.changes,
        queuedCount: poll.queued,
        failedCount: queue.failed,
      },
      state,
      cycleCompleted: !poll.hasMore,
    };
  } catch (error) {
    await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId: rootId },
      {
        $setOnInsert: { rootFolderId: rootId, assetType },
        $set: {
          status: "error",
          lastFinishedAt: new Date(),
          lastError: String(error?.message || "drive_changes_failed").slice(0, 500),
          lastChangesError: String(error?.message || "drive_changes_failed").slice(0, 500),
        },
      },
      { upsert: true },
    ).catch(() => {});
    writeSystemLog({
      type: "system",
      level: "error",
      message: "Marketplace Drive changes sync failed",
      details: { trigger, rootFolderId: rootId, error: String(error?.message || "") },
    }).catch(() => {});
    throw error;
  } finally {
    syncRunning = false;
  }
}

export function startMarketplaceDriveSyncJob() {
  if (!syncEnabled()) {
    logger.info("Marketplace Drive Changes job is disabled");
    return;
  }
  if (!configuredRoots().length) {
    logger.warn("Marketplace Drive Changes enabled but root folder id is empty");
    return;
  }
  if (syncTimer) return;
  const interval = pollIntervalMs();
  syncTimer = setInterval(() => {
    runConfiguredRootSyncs("interval");
  }, interval);
  syncTimer.unref?.();
  initialSyncTimer = setTimeout(() => {
    initialSyncTimer = null;
    runConfiguredRootSyncs("startup");
  }, 5000);
  initialSyncTimer.unref?.();
  logger.info({ pollSeconds: Math.round(interval / 1000) }, "Marketplace Drive Changes job started");
}

async function runConfiguredRootSyncs(trigger) {
  for (const root of configuredRoots()) {
    try {
      await runMarketplaceDriveSyncOnce({ trigger, rootFolderId: root.rootFolderId });
    } catch (error) {
      logger.error({ err: error, assetType: root.assetType }, "Marketplace Drive changes sync failed");
    }
  }
}

export function stopMarketplaceDriveSyncJob() {
  if (initialSyncTimer) clearTimeout(initialSyncTimer);
  if (syncTimer) clearInterval(syncTimer);
  initialSyncTimer = null;
  syncTimer = null;
}
