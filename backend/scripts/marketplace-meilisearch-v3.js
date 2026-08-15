import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { closeDbConnections, connectDb } from "../src/config/db.js";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const verifyOnly = args.has("--verify");
const resetCheckpoint = args.has("--reset");
const batchArgument = process.argv.find((value) => value.startsWith("--batch="));
const batchSize = Math.min(1_000, Math.max(50, Number(batchArgument?.split("=")[1] || 500)));
const checkpointPath = path.resolve(String(
  process.env.MARKETPLACE_MEILI_CHECKPOINT_FILE
    || (process.env.NODE_ENV === "production"
      ? path.join(process.env.BACKUP_WORK_DIR || "/var/lib/3dipl/backup-work", "marketplace-meilisearch-v3-checkpoint.json")
      : ".marketplace-meilisearch-v3-checkpoint.json"),
));

function config() {
  return {
    baseUrl: String(process.env.MEILISEARCH_URL || "").trim().replace(/\/+$/, ""),
    apiKey: String(process.env.MEILI_MASTER_KEY || "").trim(),
    modelIndex: String(process.env.MARKETPLACE_MEILI_MODEL_INDEX || "marketplace_models_v3").trim(),
    sceneIndex: String(process.env.MARKETPLACE_MEILI_SCENE_INDEX || "marketplace_scenes_v3").trim(),
  };
}

function writeCheckpoint(value) {
  const tempPath = `${checkpointPath}.tmp`;
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, checkpointPath);
}

function readCheckpoint() {
  try {
    const value = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    if (value.version === 3) return value;
  } catch {
    // Missing or invalid checkpoints start a new rebuild.
  }
  return { version: 3, stage: "new", lastId: null, processed: 0, indexed: 0 };
}

async function request(pathname, options = {}) {
  const current = config();
  const response = await fetch(`${current.baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${current.apiKey}`,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Meilisearch HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function waitTask(taskUid) {
  if (taskUid == null) return;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const task = await request(`/tasks/${taskUid}`);
    if (task.status === "succeeded") return;
    if (["failed", "canceled"].includes(task.status)) {
      throw new Error(task.error?.message || `Meilisearch task ${taskUid} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} timed out`);
}

async function deleteIndex(uid) {
  try {
    const task = await request(`/indexes/${encodeURIComponent(uid)}`, { method: "DELETE" });
    await waitTask(task.taskUid);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function ensureEmptyBaseIndex(uid) {
  try {
    await request(`/indexes/${encodeURIComponent(uid)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    const task = await request("/indexes", {
      method: "POST",
      body: { uid, primaryKey: "id" },
    });
    await waitTask(task.taskUid);
  }
}

async function stats(uid) {
  try {
    const result = await request(`/indexes/${encodeURIComponent(uid)}/stats`);
    return { documents: Number(result.numberOfDocuments || 0), indexing: Boolean(result.isIndexing) };
  } catch (error) {
    return { documents: 0, indexing: false, error: error.message };
  }
}

async function verify(MarketplaceModel, indexNames) {
  const publicQuery = (assetType) => ({
    assetType: assetType === "scene" ? "scene" : { $in: ["model", null] },
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    deletionStatus: { $nin: ["deleting", "trashed", "purging", "purged"] },
  });
  const [mongoModels, mongoScenes, searchPending, searchErrors, modelStats, sceneStats] = await Promise.all([
    MarketplaceModel.countDocuments(publicQuery("model")),
    MarketplaceModel.countDocuments(publicQuery("scene")),
    MarketplaceModel.countDocuments({ searchEngineStatus: { $in: ["pending", "disabled"] } }),
    MarketplaceModel.countDocuments({ searchEngineStatus: "error" }),
    stats(indexNames.model),
    stats(indexNames.scene),
  ]);
  return {
    mongo: { models: mongoModels, scenes: mongoScenes, searchPending, searchErrors },
    meilisearch: { models: modelStats, scenes: sceneStats },
    countsMatch: mongoModels === modelStats.documents && mongoScenes === sceneStats.documents,
  };
}

async function main() {
  const current = config();
  if (!current.baseUrl || current.apiKey.length < 16) {
    throw new Error("MEILISEARCH_URL and a 16+ character MEILI_MASTER_KEY are required");
  }
  await connectDb();
  const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
  if (verifyOnly) {
    console.log(JSON.stringify({
      mode: "verify",
      ...(await verify(MarketplaceModel, { model: current.modelIndex, scene: current.sceneIndex })),
    }, null, 2));
    return;
  }
  const counts = await Promise.all([
    MarketplaceModel.countDocuments({ assetType: { $in: ["model", null] } }),
    MarketplaceModel.countDocuments({ assetType: "scene" }),
  ]);
  if (!execute) {
    console.log(JSON.stringify({
      mode: "dry-run",
      batchSize,
      source: { models: counts[0], scenes: counts[1] },
      target: {
        models: `${current.modelIndex}_next`,
        scenes: `${current.sceneIndex}_next`,
      },
    }, null, 2));
    return;
  }
  if (process.env.MEILI_REBUILD_CONFIRM !== "marketplace-search-v3") {
    throw new Error("Set MEILI_REBUILD_CONFIRM=marketplace-search-v3 before executing the rebuild");
  }

  const nextIndexes = {
    model: `${current.modelIndex}_next`,
    scene: `${current.sceneIndex}_next`,
  };
  if (resetCheckpoint && fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  const checkpoint = readCheckpoint();
  if (checkpoint.stage === "swapped") {
    console.log(JSON.stringify({
      mode: "execute",
      checkpoint,
      verification: await verify(MarketplaceModel, {
        model: current.modelIndex,
        scene: current.sceneIndex,
      }),
    }, null, 2));
    return;
  }
  if (checkpoint.stage === "new") {
    await Promise.all([deleteIndex(nextIndexes.model), deleteIndex(nextIndexes.scene)]);
    checkpoint.stage = "indexing";
    checkpoint.startedAt = new Date().toISOString();
    writeCheckpoint(checkpoint);
  }

  process.env.MARKETPLACE_SEARCH_ENGINE = "meilisearch";
  process.env.MARKETPLACE_MEILI_MODEL_INDEX = nextIndexes.model;
  process.env.MARKETPLACE_MEILI_SCENE_INDEX = nextIndexes.scene;
  const {
    ensureMarketplaceMeiliIndexes,
    swapMarketplaceMeiliIndexes,
    syncMarketplaceSearchDocuments,
  } = await import("../src/utils/marketplaceMeilisearch.js");
  const { buildMarketplaceSearchDocuments } = await import("../src/utils/marketplaceSearch.js");
  await ensureMarketplaceMeiliIndexes();

  if (checkpoint.stage === "indexing") {
    let lastId = checkpoint.lastId || null;
    while (true) {
      const rows = await MarketplaceModel.find(lastId ? { _id: { $gt: lastId } } : {})
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();
      if (!rows.length) break;
      const searchDocuments = await buildMarketplaceSearchDocuments(rows);
      const records = rows.map((row, index) => ({
        model: { ...row, ...searchDocuments[index] },
        searchDocument: searchDocuments[index],
      }));
      await syncMarketplaceSearchDocuments(records);
      await MarketplaceModel.updateMany(
        { _id: { $in: rows.map((row) => row._id) } },
        {
          $set: {
            searchEngineStatus: "indexed",
            searchEngineIndexedAt: new Date(),
            searchEngineError: "",
          },
        },
      );
      checkpoint.processed += rows.length;
      checkpoint.indexed += rows.length;
      lastId = rows.at(-1)._id;
      checkpoint.lastId = String(lastId);
      writeCheckpoint(checkpoint);
      console.log(`Meilisearch V3 indexed ${checkpoint.indexed} assets.`);
    }
    checkpoint.stage = "verifying";
    writeCheckpoint(checkpoint);
  }

  const nextVerification = await verify(MarketplaceModel, nextIndexes);
  if (!nextVerification.countsMatch || nextVerification.mongo.searchErrors > 0) {
    throw new Error(`Next-index verification failed: ${JSON.stringify(nextVerification)}`);
  }
  if (checkpoint.stage !== "swapped") {
    await Promise.all([
      ensureEmptyBaseIndex(current.modelIndex),
      ensureEmptyBaseIndex(current.sceneIndex),
    ]);
    await swapMarketplaceMeiliIndexes([
      [current.modelIndex, nextIndexes.model],
      [current.sceneIndex, nextIndexes.scene],
    ]);
    checkpoint.stage = "swapped";
    checkpoint.completedAt = new Date().toISOString();
    writeCheckpoint(checkpoint);
  }
  console.log(JSON.stringify({ mode: "execute", checkpoint, nextVerification }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
