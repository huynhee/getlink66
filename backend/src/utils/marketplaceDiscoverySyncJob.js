import MarketplaceModel from "../models/MarketplaceModel.js";
import { marketplaceDiscoveryConfigured, syncMarketplaceDiscoveryAsset } from "./marketplaceDiscovery.js";
import logger from "./logger.js";

let timer = null;
let running = false;

function intervalMs() {
  return Math.max(10_000, Number(process.env.MARKETPLACE_DISCOVERY_SYNC_INTERVAL_MS || 30_000));
}

function batchSize() {
  return Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_DISCOVERY_SYNC_BATCH_SIZE || 20)));
}

export async function runMarketplaceDiscoverySyncBatch() {
  if (running || !marketplaceDiscoveryConfigured()) return { processed: 0, skipped: true };
  running = true;
  let processed = 0;
  try {
    const assets = await MarketplaceModel.find({ discoveryStatus: { $in: ["pending", "error"] } })
      .sort({ updatedAt: 1 })
      .limit(batchSize())
      .lean();
    for (const asset of assets) {
      try {
        await syncMarketplaceDiscoveryAsset(asset);
        await MarketplaceModel.findByIdAndUpdate(asset._id, {
          $set: {
            discoveryStatus: "indexed",
            discoveryIndexedAt: new Date(),
            discoveryError: "",
          },
          $inc: { discoveryRevision: 1 },
        });
      } catch (error) {
        await MarketplaceModel.findByIdAndUpdate(asset._id, {
          $set: { discoveryStatus: "error", discoveryError: String(error?.message || "Discovery sync failed").slice(0, 500) },
        });
        logger.warn({ err: error, assetId: asset._id, assetType: asset.assetType }, "Marketplace discovery sync failed");
      }
      processed += 1;
    }
    return { processed, skipped: false };
  } finally {
    running = false;
  }
}

export function startMarketplaceDiscoverySyncJob() {
  if (!marketplaceDiscoveryConfigured() || timer) return;
  timer = setInterval(() => {
    runMarketplaceDiscoverySyncBatch().catch((error) => logger.error({ err: error }, "Marketplace discovery worker failed"));
  }, intervalMs());
  timer.unref?.();
  setTimeout(() => runMarketplaceDiscoverySyncBatch().catch(() => {}), 2_000).unref?.();
  logger.info({ intervalMs: intervalMs() }, "Marketplace discovery sync job started");
}

export function stopMarketplaceDiscoverySyncJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
