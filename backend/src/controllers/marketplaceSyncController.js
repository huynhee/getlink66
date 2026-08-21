import {
  getMarketplaceDriveSyncState,
  marketplaceDriveSyncConfig,
  processMarketplaceDriveChangeQueue,
  retryFailedMarketplaceDriveChanges,
  runMarketplaceDriveSyncOnce,
} from "../utils/marketplaceDriveSyncJob.js";
import { requeueFailedMarketplaceCoverCaches } from "../utils/marketplaceCoverCache.js";
import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import { rejectUnknownKeys } from "../utils/validators.js";
import {
  cancelMarketplaceDriveReconciliation,
  queueMarketplaceDriveReconciliation,
  runMarketplaceDriveReconcileTick,
} from "../utils/marketplaceDriveReconcileJob.js";

export async function adminMarketplaceDriveSyncState(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const config = marketplaceDriveSyncConfig();
    const rootFolderId = config.roots?.find((item) => item.assetType === assetType)?.rootFolderId || "";
    const [state, pending, failed, recentFailures] = await Promise.all([
      getMarketplaceDriveSyncState(assetType),
      MarketplaceDriveChange.countDocuments({ rootFolderId, status: { $in: ["pending", "processing"] } }),
      MarketplaceDriveChange.countDocuments({ rootFolderId, status: "failed" }),
      MarketplaceDriveChange.find({ rootFolderId, status: "failed" })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select("driveFolderId attempts lastError nextAttemptAt updatedAt")
        .lean(),
    ]);
    res.json({ config: { ...config, assetType, rootFolderId }, state: state || null, queue: { pending, failed, recentFailures } });
  } catch (error) {
    next(error);
  }
}

export async function adminRunMarketplaceDriveSync(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const config = marketplaceDriveSyncConfig();
    const configuredRoot = config.roots?.find((item) => item.assetType === assetType)?.rootFolderId || "";
    const unknownKey = rejectUnknownKeys(req.body || {}, ["rootFolderId"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid sync request" });
    const { result, state, cycleCompleted } = await runMarketplaceDriveSyncOnce({
      trigger: "manual",
      rootFolderId: String(req.body?.rootFolderId || configuredRoot).trim(),
    });
    res.json({
      scannedFolders: result.scannedFolders,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      unchangedCount: result.unchangedCount,
      changesCount: result.changesCount,
      queuedCount: result.queuedCount,
      failedCount: result.failedCount,
      cycleCompleted,
      state: state || null,
    });
  } catch (error) {
    next(error);
  }
}

export async function adminRetryMarketplaceDriveFailures(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const config = marketplaceDriveSyncConfig();
    const configuredRoot = config.roots?.find((item) => item.assetType === assetType)?.rootFolderId || "";
    const unknownKey = rejectUnknownKeys(req.body || {}, ["rootFolderId"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid retry request" });
    const rootFolderId = String(req.body?.rootFolderId || configuredRoot).trim();
    const requeued = await retryFailedMarketplaceDriveChanges({ rootId: rootFolderId });
    const queue = requeued
      ? await processMarketplaceDriveChangeQueue({ rootId: rootFolderId, limit: requeued })
      : { processed: 0, failed: 0, results: [] };
    return res.json({ requeued, ...queue });
  } catch (error) {
    return next(error);
  }
}

export async function adminRetryMarketplaceCoverFailures(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const unknownKey = rejectUnknownKeys(req.body || {}, []);
    if (unknownKey) return res.status(400).json({ message: "Invalid cover retry request" });
    const requeued = await requeueFailedMarketplaceCoverCaches({ assetType });
    return res.json({ requeued, assetType });
  } catch (error) {
    return next(error);
  }
}

export async function adminStartMarketplaceDriveReconciliation(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const config = marketplaceDriveSyncConfig();
    const configuredRoot = config.roots?.find((item) => item.assetType === assetType)?.rootFolderId || "";
    const unknownKey = rejectUnknownKeys(req.body || {}, ["rootFolderId", "batchSize", "reset"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid reconciliation start request" });
    const state = await queueMarketplaceDriveReconciliation({
      assetType,
      rootFolderId: String(req.body?.rootFolderId || configuredRoot).trim(),
      batchSize: Number(req.body?.batchSize || 100),
      reset: req.body?.reset !== false,
    });
    runMarketplaceDriveReconcileTick().catch(() => {});
    return res.status(202).json({ state });
  } catch (error) {
    return next(error);
  }
}

export async function adminCancelMarketplaceDriveReconciliation(req, res, next) {
  try {
    const assetType = req.marketplaceAssetType === "scene" ? "scene" : "model";
    const config = marketplaceDriveSyncConfig();
    const configuredRoot = config.roots?.find((item) => item.assetType === assetType)?.rootFolderId || "";
    const unknownKey = rejectUnknownKeys(req.body || {}, ["rootFolderId"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid reconciliation cancel request" });
    const state = await cancelMarketplaceDriveReconciliation({
      assetType,
      rootFolderId: String(req.body?.rootFolderId || configuredRoot).trim(),
    });
    if (!state) {
      return res.status(409).json({
        message: "No active full Drive reconciliation was found",
        code: "MARKETPLACE_RECONCILIATION_NOT_ACTIVE",
      });
    }
    return res.json({ state });
  } catch (error) {
    return next(error);
  }
}
