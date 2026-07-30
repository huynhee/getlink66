import MarketplaceModel from "../models/MarketplaceModel.js";
import {
  marketplaceCoverCacheConfig,
  processMarketplaceCoverCacheModel,
} from "./marketplaceCoverCache.js";
import logger from "./logger.js";

let timer = null;
let running = false;

function intervalMs() {
  return Math.max(1_000, Number(process.env.MARKETPLACE_COVER_WORKER_INTERVAL_MS || 2_000));
}

async function claimCoverCacheModel() {
  const config = marketplaceCoverCacheConfig();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const model = await MarketplaceModel.findOneAndUpdate(
    {
      "coverCache.attempts": { $lt: config.maxAttempts },
      $or: [
        {
          "coverCache.status": { $in: ["queued", "error"] },
          "coverCache.nextRetryAt": { $lte: new Date() },
        },
        {
          "coverCache.status": "processing",
          "coverCache.lockedAt": { $lt: staleBefore },
        },
      ],
    },
    {
      $set: {
        "coverCache.status": "processing",
        "coverCache.lockedAt": new Date(),
        "coverCache.error": "",
      },
      $inc: { "coverCache.attempts": 1 },
    },
    { new: true, sort: { "coverCache.nextRetryAt": 1, updatedAt: 1 } },
  );
  return model?.toObject ? model.toObject() : model;
}

export async function runMarketplaceCoverCacheBatch() {
  const config = marketplaceCoverCacheConfig();
  if (!config.enabled || !config.workerEnabled || running) return { processed: 0, failed: 0, skipped: true };
  running = true;
  let processed = 0;
  let failed = 0;
  try {
    const claimed = [];
    for (let index = 0; index < config.concurrency; index += 1) {
      const model = await claimCoverCacheModel();
      if (!model) break;
      claimed.push(model);
    }
    await Promise.all(claimed.map(async (model) => {
      try {
        await processMarketplaceCoverCacheModel(model);
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.warn(
          { err: error, assetId: model._id, assetType: model.assetType },
          "Marketplace cover cache generation failed",
        );
      }
    }));
    return { processed, failed, skipped: false };
  } finally {
    running = false;
  }
}

export function startMarketplaceCoverCacheJob() {
  const config = marketplaceCoverCacheConfig();
  if (timer || !config.enabled || !config.workerEnabled) return;
  timer = setInterval(() => {
    runMarketplaceCoverCacheBatch()
      .catch((error) => logger.error({ err: error }, "Marketplace cover cache worker failed"));
  }, intervalMs());
  timer.unref?.();
  setTimeout(() => runMarketplaceCoverCacheBatch().catch(() => {}), 3_000).unref?.();
}

export function stopMarketplaceCoverCacheJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
