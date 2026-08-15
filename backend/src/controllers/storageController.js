import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStorageHealthSnapshot } from "../utils/storageHealthService.js";
import logger from "../utils/logger.js";

let searchRebuildProcess = null;
let searchRebuildState = { running: false, startedAt: null, pid: null };

function searchCheckpointPath() {
  return path.resolve(String(
    process.env.MARKETPLACE_MEILI_CHECKPOINT_FILE
      || (process.env.NODE_ENV === "production"
        ? path.join(process.env.BACKUP_WORK_DIR || "/var/lib/3dipl/backup-work", "marketplace-meilisearch-v3-checkpoint.json")
        : ".marketplace-meilisearch-v3-checkpoint.json"),
  ));
}

function shouldResetSearchRebuild() {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(searchCheckpointPath(), "utf8"));
    return !["indexing", "verifying"].includes(checkpoint.stage);
  } catch {
    return true;
  }
}

export async function adminStorageHealth(_req, res, next) {
  try {
    const storage = await buildStorageHealthSnapshot({ verifyDrive: true });
    return res.json({ storage });
  } catch (error) {
    return next(error);
  }
}

export async function adminRebuildMarketplaceSearch(_req, res, next) {
  try {
    if (String(process.env.MARKETPLACE_SEARCH_ENGINE || "mongo").toLowerCase() !== "meilisearch") {
      return res.status(409).json({ message: "Meilisearch is not enabled", code: "MEILISEARCH_DISABLED" });
    }
    if (searchRebuildProcess && searchRebuildProcess.exitCode === null) {
      return res.status(409).json({
        message: "Marketplace search rebuild is already running",
        code: "MEILISEARCH_REBUILD_ACTIVE",
        rebuild: searchRebuildState,
      });
    }
    const scriptPath = fileURLToPath(new URL("../../scripts/marketplace-meilisearch-v3.js", import.meta.url));
    const args = [scriptPath, "--execute"];
    if (shouldResetSearchRebuild()) args.push("--reset");
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(path.dirname(scriptPath)),
      env: {
        ...process.env,
        MEILI_REBUILD_CONFIRM: "marketplace-search-v3",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    searchRebuildProcess = child;
    searchRebuildState = {
      running: true,
      startedAt: new Date(),
      pid: child.pid,
    };
    child.stdout.on("data", (chunk) => logger.info({ output: String(chunk).trim() }, "Marketplace search rebuild"));
    child.stderr.on("data", (chunk) => logger.warn({ output: String(chunk).trim() }, "Marketplace search rebuild"));
    child.once("error", (error) => {
      searchRebuildState = {
        ...searchRebuildState,
        running: false,
        completedAt: new Date(),
        error: String(error.message || error).slice(0, 500),
      };
      searchRebuildProcess = null;
      logger.error({ err: error }, "Marketplace search rebuild could not start");
    });
    child.once("exit", (code, signal) => {
      searchRebuildState = {
        ...searchRebuildState,
        running: false,
        completedAt: new Date(),
        exitCode: code,
        signal: signal || null,
      };
      searchRebuildProcess = null;
      logger[code === 0 ? "info" : "error"]({ code, signal }, "Marketplace search rebuild finished");
    });
    return res.status(202).json({ rebuild: searchRebuildState });
  } catch (error) {
    return next(error);
  }
}
