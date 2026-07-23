import MarketplaceModel from "../models/MarketplaceModel.js";
import { googleDriveWriteEnabled } from "./storageProvider.js";
import { permanentlyDeleteMarketplaceAsset } from "./marketplaceDeletionService.js";
import logger from "./logger.js";

let timer = null;
let running = false;

function intervalMs() {
  return Math.max(60_000, Number(process.env.MARKETPLACE_TRASH_PURGE_INTERVAL_MS || 60 * 60 * 1000));
}

function batchSize() {
  return Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_TRASH_PURGE_BATCH_SIZE || 20)));
}

export async function runMarketplaceDeletionBatch() {
  if (running || !googleDriveWriteEnabled()) return { processed: 0, skipped: true };
  running = true;
  let processed = 0;
  let failed = 0;
  try {
    const assets = await MarketplaceModel.find({
      deletionStatus: { $in: ["trashed", "purge_error"] },
      purgeAt: { $lte: new Date() },
    })
      .sort({ purgeAt: 1 })
      .limit(batchSize())
      .lean();
    for (const asset of assets) {
      try {
        await permanentlyDeleteMarketplaceAsset(asset);
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.warn({ err: error, assetId: asset._id, assetType: asset.assetType }, "Marketplace trash purge failed");
      }
    }
    return { processed, failed, skipped: false };
  } finally {
    running = false;
  }
}

export function startMarketplaceDeletionJob() {
  if (timer) return;
  timer = setInterval(() => {
    runMarketplaceDeletionBatch().catch((error) => logger.error({ err: error }, "Marketplace trash worker failed"));
  }, intervalMs());
  timer.unref?.();
  setTimeout(() => runMarketplaceDeletionBatch().catch(() => {}), 5_000).unref?.();
}

export function stopMarketplaceDeletionJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
