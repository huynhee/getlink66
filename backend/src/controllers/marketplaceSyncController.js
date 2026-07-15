import {
  getMarketplaceDriveSyncState,
  marketplaceDriveSyncConfig,
  runMarketplaceDriveSyncOnce,
} from "../utils/marketplaceDriveSyncJob.js";
import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import { rejectUnknownKeys } from "../utils/validators.js";

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
