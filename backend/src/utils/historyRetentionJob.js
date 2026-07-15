import logger from "./logger.js";
import { runHistoryRetentionCycle } from "./historyRetentionService.js";

let timer = null;
let running = false;
let enabled = false;

function delayUntilNextRun(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  let target = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    2 - 7,
    30,
    0,
    0,
  ));
  if (target <= now) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  return target.getTime() - now.getTime();
}

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await runHistoryRetentionCycle();
    logger.info(result, "History retention cycle completed");
  } catch (error) {
    logger.error({ err: error }, "History retention cycle failed; Mongo records were retained");
  } finally {
    running = false;
  }
}

function schedule() {
  if (!enabled || process.env.HISTORY_RETENTION_JOB_ENABLED === "false") return;
  timer = setTimeout(async () => {
    timer = null;
    await run();
    schedule();
  }, delayUntilNextRun());
  timer.unref?.();
}

export function startHistoryRetentionJob() {
  if (enabled || process.env.HISTORY_RETENTION_JOB_ENABLED === "false") return;
  enabled = true;
  if (process.env.HISTORY_RETENTION_RUN_ON_START === "true") run();
  schedule();
}

export function stopHistoryRetentionJob() {
  enabled = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
