import logger from "./logger.js";
import { buildStorageHealthSnapshot } from "./storageHealthService.js";
import { sendTelegramNotification } from "./telegramNotifier.js";

let timer = null;
let running = false;
let stopping = false;
const sentAt = new Map();

function intervalMs() {
  const value = Number(process.env.STORAGE_HEALTH_INTERVAL_MS || 60 * 60 * 1000);
  return Math.max(5 * 60 * 1000, Number.isFinite(value) ? value : 60 * 60 * 1000);
}

function shouldSend(code) {
  const now = Date.now();
  const cooldown = Number(process.env.STORAGE_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000);
  const previous = sentAt.get(code) || 0;
  if (now - previous < cooldown) return false;
  sentAt.set(code, now);
  return true;
}

async function run() {
  if (running || stopping) return;
  running = true;
  try {
    const snapshot = await buildStorageHealthSnapshot({ verifyDrive: true });
    if (stopping) return;
    const capacityPressure = Number(snapshot.databases?.core?.usagePercent || 0) >= 85
      || Number(snapshot.disk?.usagePercent || 0) >= 85;
    if (
      capacityPressure
      && process.env.STORAGE_EMERGENCY_RETENTION_ENABLED !== "false"
      && shouldSend("EMERGENCY_RETENTION")
    ) {
      try {
        const { runHistoryRetentionCycle } = await import("./historyRetentionService.js");
        const retention = await runHistoryRetentionCycle({
          batchSize: Number(process.env.STORAGE_EMERGENCY_RETENTION_BATCH_SIZE || 1000),
        });
        logger.warn({ retention }, "Emergency verified history retention completed");
      } catch (error) {
        logger.error({ err: error }, "Emergency history retention failed; Mongo records were retained");
        if (shouldSend("EMERGENCY_RETENTION_FAILED")) {
          await sendTelegramNotification(
            `<b>3DIPL storage critical</b>\nCode: <code>EMERGENCY_RETENTION_FAILED</code>\n${String(error.message || error).slice(0, 500)}`,
            { dedupeKey: "storage:EMERGENCY_RETENTION_FAILED" },
          ).catch((notifyError) => {
            logger.error({ err: notifyError }, "Emergency retention alert delivery failed");
          });
        }
      }
    }
    for (const alert of snapshot.alerts) {
      if (stopping) break;
      if (!shouldSend(alert.code)) continue;
      await sendTelegramNotification(
        `<b>3DIPL storage ${alert.severity}</b>\nCode: <code>${alert.code}</code>\n${alert.message}`,
        { dedupeKey: `storage:${alert.code}` },
      ).catch((error) => {
        logger.error({ err: error, alertCode: alert.code }, "Storage alert delivery failed");
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Storage health monitor failed");
  } finally {
    running = false;
  }
}

export function startStorageHealthJob() {
  if (timer || process.env.STORAGE_HEALTH_JOB_ENABLED === "false") return;
  stopping = false;
  if (process.env.STORAGE_HEALTH_RUN_ON_START === "true") run();
  timer = setInterval(run, intervalMs());
  timer.unref?.();
}

export function stopStorageHealthJob() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
}
