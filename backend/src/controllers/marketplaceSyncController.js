import {
  getMarketplaceDriveSyncState,
  marketplaceDriveSyncConfig,
  runMarketplaceDriveSyncOnce,
} from "../utils/marketplaceDriveSyncJob.js";
import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import { rejectUnknownKeys } from "../utils/validators.js";

export async function adminMarketplaceDriveSyncState(_req, res, next) {
  try {
    const config = marketplaceDriveSyncConfig();
    const [state, pending, failed, recentFailures] = await Promise.all([
      getMarketplaceDriveSyncState(),
      MarketplaceDriveChange.countDocuments({ rootFolderId: config.rootFolderId, status: { $in: ["pending", "processing"] } }),
      MarketplaceDriveChange.countDocuments({ rootFolderId: config.rootFolderId, status: "failed" }),
      MarketplaceDriveChange.find({ rootFolderId: config.rootFolderId, status: "failed" })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select("driveFolderId attempts lastError nextAttemptAt updatedAt")
        .lean(),
    ]);
    res.json({ config, state: state || null, queue: { pending, failed, recentFailures } });
  } catch (error) {
    next(error);
  }
}

export async function adminRunMarketplaceDriveSync(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body || {}, ["rootFolderId"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid sync request" });
    const { result, state, cycleCompleted } = await runMarketplaceDriveSyncOnce({
      trigger: "manual",
      rootFolderId: String(req.body?.rootFolderId || "").trim(),
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
