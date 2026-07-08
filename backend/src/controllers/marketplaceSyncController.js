import {
  getMarketplaceDriveSyncState,
  marketplaceDriveSyncConfig,
  runMarketplaceDriveSyncOnce,
} from "../utils/marketplaceDriveSyncJob.js";
import { rejectUnknownKeys } from "../utils/validators.js";

export async function adminMarketplaceDriveSyncState(_req, res, next) {
  try {
    const [config, state] = await Promise.all([
      Promise.resolve(marketplaceDriveSyncConfig()),
      getMarketplaceDriveSyncState(),
    ]);
    res.json({ config, state: state || null });
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
      hasMore: result.hasMore,
      cycleCompleted,
      state: state || null,
    });
  } catch (error) {
    next(error);
  }
}
