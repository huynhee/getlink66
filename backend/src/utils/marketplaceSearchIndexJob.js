import { runMarketplaceSearchIndexBatch } from "./marketplaceSearch.js";
import logger from "./logger.js";

let timer = null;
let running = false;

function enabled() {
  return String(process.env.MARKETPLACE_BILINGUAL_SEARCH_ENABLED || "false").toLowerCase() === "true";
}

async function run() {
  if (running || !enabled()) return;
  running = true;
  try {
    await runMarketplaceSearchIndexBatch(Number(process.env.MARKETPLACE_SEARCH_INDEX_BATCH_SIZE || 100));
  } finally {
    running = false;
  }
}

export function startMarketplaceSearchIndexJob() {
  if (!enabled() || timer) return;
  const intervalMs = Math.max(10_000, Number(process.env.MARKETPLACE_SEARCH_INDEX_INTERVAL_MS || 30_000));
  timer = setInterval(() => run().catch((error) => logger.warn({ err: error }, "Marketplace search index job failed")), intervalMs);
  timer.unref?.();
  setTimeout(() => run().catch(() => {}), 2_500).unref?.();
}

export function stopMarketplaceSearchIndexJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
