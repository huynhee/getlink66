import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { closeDbConnections, connectDb } from "../src/config/db.js";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const verifyOnly = args.has("--verify");
const retryErrors = args.has("--retry-errors");
const batchArgument = process.argv.find((value) => value.startsWith("--batch="));
const batchSize = Math.min(2_000, Math.max(50, Number(batchArgument?.split("=")[1] || 500)));
const checkpointPath = path.resolve(process.cwd(), ".cache", "marketplace-cover-backfill.json");

function readCheckpoint() {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    if (checkpoint.completedAt) return { processed: 0, queued: 0, lastId: null };
    return checkpoint;
  } catch {
    return { processed: 0, queued: 0, lastId: null };
  }
}

function writeCheckpoint(checkpoint) {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function activeCoverQuery(lastId = null) {
  const query = {
    "coverImage.driveFileId": { $type: "string", $gt: "" },
    $or: [{ deletionStatus: "active" }, { deletionStatus: { $exists: false } }],
  };
  if (lastId) query._id = { $gt: lastId };
  return query;
}

async function verify(MarketplaceModel, verifyMarketplaceCoverCacheFile) {
  const cursor = MarketplaceModel.find({ "coverCache.status": "ready" })
    .sort({ _id: 1 })
    .select("_id assetType title coverCache")
    .cursor();
  let inspected = 0;
  let valid = 0;
  const invalid = [];
  for await (const row of cursor) {
    const result = await verifyMarketplaceCoverCacheFile(row);
    inspected += 1;
    if (result.ok) valid += 1;
    else if (invalid.length < 50) {
      invalid.push({
        id: String(row._id),
        assetType: row.assetType,
        title: row.title,
        key: row.coverCache?.key || "",
        reason: result.reason || "invalid_dimensions",
      });
    }
  }
  const counts = {};
  for (const status of ["missing", "queued", "processing", "ready", "error"]) {
    counts[status] = await MarketplaceModel.countDocuments({ "coverCache.status": status });
  }
  return { inspected, valid, invalidCount: inspected - valid, invalid, counts };
}

async function main() {
  await connectDb();
  const [
    { default: MarketplaceModel },
    {
      marketplaceCoverCacheConfig,
      marketplaceCoverSourceFingerprint,
      queueMarketplaceCoverCache,
      requeueFailedMarketplaceCoverCaches,
      verifyMarketplaceCoverCacheFile,
    },
  ] = await Promise.all([
    import("../src/models/MarketplaceModel.js"),
    import("../src/utils/marketplaceCoverCache.js"),
  ]);
  const config = marketplaceCoverCacheConfig();

  if (verifyOnly) {
    console.log(JSON.stringify({
      mode: "verify",
      config,
      ...(await verify(MarketplaceModel, verifyMarketplaceCoverCacheFile)),
    }, null, 2));
    return;
  }
  if (execute && !config.enabled) {
    throw new Error("Set MARKETPLACE_COVER_CACHE_ENABLED=true before running cover backfill.");
  }

  if (retryErrors) {
    const failed = await MarketplaceModel.countDocuments({ "coverCache.status": "error" });
    const requeued = execute ? await requeueFailedMarketplaceCoverCaches() : failed;
    console.log(JSON.stringify({
      mode: execute ? "retry-errors" : "retry-errors-dry-run",
      failed,
      requeued,
    }, null, 2));
    return;
  }

  const checkpoint = execute ? readCheckpoint() : { processed: 0, queued: 0, lastId: null };
  let lastId = checkpoint.lastId || null;
  let inspected = Number(checkpoint.processed || 0);
  let queued = Number(checkpoint.queued || 0);

  while (true) {
    const rows = await MarketplaceModel.find(activeCoverQuery(lastId))
      .sort({ _id: 1 })
      .limit(batchSize)
      .select("_id assetType coverImage coverCache")
      .lean();
    if (!rows.length) break;

    for (const row of rows) {
      const fingerprint = marketplaceCoverSourceFingerprint(row.coverImage);
      let needsQueue = row.coverCache?.sourceFingerprint !== fingerprint
        || !["queued", "processing", "ready", "error"].includes(row.coverCache?.status);
      if (!needsQueue && row.coverCache?.status === "ready") {
        needsQueue = !(await verifyMarketplaceCoverCacheFile(row)).ok;
      }
      if (needsQueue) {
        queued += 1;
        if (execute) await queueMarketplaceCoverCache(row, row.coverImage, { force: true });
      }
    }

    inspected += rows.length;
    lastId = rows.at(-1)._id;
    if (execute) {
      Object.assign(checkpoint, {
        processed: inspected,
        queued,
        lastId: String(lastId),
        updatedAt: new Date().toISOString(),
      });
      writeCheckpoint(checkpoint);
    }
    console.log(`${execute ? "Queued" : "Would queue"} ${queued} of ${inspected} inspected covers.`);
  }

  if (execute) {
    checkpoint.completedAt = new Date().toISOString();
    writeCheckpoint(checkpoint);
  }
  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    inspected,
    queued,
    batchSize,
    checkpointPath: execute ? checkpointPath : null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
