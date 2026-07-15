import logger from "./logger.js";
import { retryPendingMarketplaceQuotaGrants } from "./marketplaceQuotaGrantService.js";

let timer = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await retryPendingMarketplaceQuotaGrants();
    if (result.applied || result.errors.length) {
      logger.info(result, "Marketplace quota grants synchronized");
    }
  } catch (error) {
    logger.error({ err: error }, "Marketplace quota grant worker failed");
  } finally {
    running = false;
  }
}

export function startMarketplaceQuotaGrantJob() {
  if (timer || process.env.MARKETPLACE_QUOTA_GRANT_JOB_ENABLED === "false") return;
  const intervalMs = Math.max(10_000, Number(process.env.MARKETPLACE_QUOTA_GRANT_INTERVAL_MS || 60_000));
  run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
}

export function stopMarketplaceQuotaGrantJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
