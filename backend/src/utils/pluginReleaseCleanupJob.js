import { pluginReleaseService } from "../services/pluginReleaseService.js";
import logger from "./logger.js";

let timer;
let running;
export function startPluginReleaseCleanupJob() {
  if (timer || process.env.PLUGIN_RELEASE_SOURCE !== "database") return;
  const tick = () => {
    if (running) return;
    running = pluginReleaseService.cleanupUploads()
      .catch((error) => logger.error({ err: error }, "Plugin upload cleanup failed"))
      .finally(() => { running = null; });
  };
  timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  tick();
}
export async function stopPluginReleaseCleanupJob() {
  clearInterval(timer);
  timer = null;
  await running;
}
