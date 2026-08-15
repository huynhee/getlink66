import ModelDownload from "../models/ModelDownload.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { isMemoryDb } from "../config/memoryStore.js";
import logger from "./logger.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
let timer = null;
let running = false;

export async function refreshMarketplacePopularity24h(now = new Date()) {
  if (running || isMemoryDb()) return { skipped: true, updated: 0 };
  running = true;
  try {
    const rows = await ModelDownload.aggregate([
      {
        $match: {
          status: "downloaded",
          downloadedAt: { $gte: new Date(now.getTime() - WINDOW_MS), $lte: now },
        },
      },
      { $group: { _id: "$modelId", count: { $sum: 1 } } },
    ]);
    const counts = new Map(rows.map((row) => [String(row._id || ""), Number(row.count || 0)]));
    const current = await MarketplaceModel.find({ popularity24h: { $gt: 0 } })
      .select("_id popularity24h")
      .lean();
    const existing = new Map(current.map((model) => [String(model._id), Number(model.popularity24h || 0)]));
    const ids = new Set([...counts.keys(), ...existing.keys()]);
    const operations = [...ids].flatMap((modelId) => {
      if (!modelId) return [];
      const next = Number(counts.get(modelId) || 0);
      if (next === Number(existing.get(modelId) || 0)) return [];
      return [{
        updateOne: {
          filter: { _id: modelId },
          update: {
            $set: {
              popularity24h: next,
              popularity24hUpdatedAt: now,
              searchEngineStatus: "pending",
              searchEngineError: "",
            },
          },
        },
      }];
    });
    if (operations.length) await MarketplaceModel.bulkWrite(operations, { ordered: false });
    return { skipped: false, updated: operations.length, active: counts.size };
  } finally {
    running = false;
  }
}

export function startMarketplacePopularityJob() {
  if (timer || String(process.env.MARKETPLACE_POPULARITY_WORKER_ENABLED || "true").toLowerCase() !== "true") return;
  const intervalMs = Math.max(60_000, Number(
    process.env.MARKETPLACE_POPULARITY_WORKER_INTERVAL_MS || 10 * 60_000,
  ));
  refreshMarketplacePopularity24h().catch((error) => {
    logger.warn({ err: error }, "Marketplace 24-hour popularity refresh failed");
  });
  timer = setInterval(() => {
    refreshMarketplacePopularity24h().catch((error) => {
      logger.warn({ err: error }, "Marketplace 24-hour popularity refresh failed");
    });
  }, intervalMs);
  timer.unref?.();
}

export function stopMarketplacePopularityJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
