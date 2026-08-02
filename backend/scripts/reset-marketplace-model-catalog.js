import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import {
  closeDbConnections,
  connectDb,
  marketplaceDbConnection,
  marketplaceDbUsesCore,
} from "../src/config/db.js";

const requestedAssetType = process.argv
  .find((value) => value.startsWith("--asset-type="))
  ?.slice("--asset-type=".length) || "model";
if (!new Set(["model", "scene"]).has(requestedAssetType)) {
  throw new Error("--asset-type must be model or scene");
}
const isScene = requestedAssetType === "scene";
const CONFIRM_TOKEN = isScene ? "RESET_SCENE_CATALOG" : "RESET_MODEL_CATALOG";
const execute = process.argv.includes("--execute");
const confirmation = process.argv
  .find((value) => value.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const assetQuery = isScene ? { assetType: "scene" } : { assetType: { $ne: "scene" } };

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadResetData(models) {
  const [
    { default: DownloadSession },
    { default: MarketplaceDriveChange },
    { default: MarketplaceDriveSyncState },
    { default: MarketplaceReport },
    { default: ModelDownload },
  ] = await Promise.all([
    import("../src/models/DownloadSession.js"),
    import("../src/models/MarketplaceDriveChange.js"),
    import("../src/models/MarketplaceDriveSyncState.js"),
    import("../src/models/MarketplaceReport.js"),
    import("../src/models/ModelDownload.js"),
  ]);
  const modelIds = models.map((model) => model._id);
  const rootFolderId = String(process.env[isScene ? "SCENES_DRIVE_ROOT_FOLDER_ID" : "MARKETPLACE_DRIVE_ROOT_FOLDER_ID"] || "").trim();
  const stateQuery = rootFolderId
    ? { $or: [assetQuery, { rootFolderId }] }
    : assetQuery;
  const [sessions, downloads, reports, driveChanges, syncStates] = await Promise.all([
    DownloadSession.find({ modelId: { $in: modelIds } }).lean(),
    ModelDownload.find({ modelId: { $in: modelIds } }).lean(),
    MarketplaceReport.find({ modelId: { $in: modelIds } }).lean(),
    MarketplaceDriveChange.find(stateQuery).lean(),
    MarketplaceDriveSyncState.find(stateQuery).lean(),
  ]);
  return {
    models,
    sessions,
    downloads,
    reports,
    driveChanges,
    syncStates,
    modelIds,
    rootFolderId,
    modelsByName: {
      DownloadSession,
      MarketplaceDriveChange,
      MarketplaceDriveSyncState,
      MarketplaceReport,
      ModelDownload,
    },
  };
}

async function writeBackup(data) {
  const backupDir = path.resolve(".cache/catalog-reset-backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${requestedAssetType}-catalog-${stamp}.json.gz`;
  const outputPath = path.join(backupDir, fileName);
  const tempPath = `${outputPath}.tmp`;
  const payload = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    databaseTarget: marketplaceDbUsesCore() ? "atlas-core" : "marketplace-vps",
    assetType: requestedAssetType,
    data: {
      models: jsonSafe(data.models),
      downloadSessions: jsonSafe(data.sessions),
      modelDownloads: jsonSafe(data.downloads),
      marketplaceReports: jsonSafe(data.reports),
      driveChanges: jsonSafe(data.driveChanges),
      driveSyncStates: jsonSafe(data.syncStates),
    },
  };
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  const sha256 = crypto.createHash("sha256").update(compressed).digest("hex");
  await fs.writeFile(tempPath, compressed);
  await fs.rename(tempPath, outputPath);
  await fs.writeFile(`${outputPath}.sha256`, `${sha256}  ${fileName}\n`, "utf8");
  return { outputPath, sha256, size: compressed.length };
}

function summary(data) {
  return {
    databaseTarget: marketplaceDbUsesCore() ? "atlas-core" : "marketplace-vps",
    assets: data.models.length,
    downloadSessions: data.sessions.length,
    modelDownloads: data.downloads.length,
    marketplaceReports: data.reports.length,
    driveChanges: data.driveChanges.length,
    driveSyncStates: data.syncStates.length,
    googleDriveFiles: 0,
    assetType: requestedAssetType,
    taxonomy: 0,
  };
}

async function main() {
  if (execute && confirmation !== CONFIRM_TOKEN) {
    throw new Error(`Execution requires --confirm=${CONFIRM_TOKEN}`);
  }
  await connectDb();
  const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
  const models = await MarketplaceModel.find(assetQuery).lean();
  const data = await loadResetData(models);
  const before = summary(data);
  if (!execute) {
    console.log(JSON.stringify({
      mode: "dry-run",
      wouldDelete: before,
      note: `Run with --asset-type=${requestedAssetType} --execute --confirm=${CONFIRM_TOKEN} to create a local gzip backup and reset only the ${requestedAssetType} catalog.`,
    }, null, 2));
    return;
  }

  const backup = await writeBackup(data);
  const { removeMarketplaceCoverCache } = await import("../src/utils/marketplaceCoverCache.js");
  let cacheFilesRemoved = 0;
  let cacheErrors = 0;
  for (const model of models) {
    if (!model.coverCache?.key) continue;
    try {
      await removeMarketplaceCoverCache(model);
      cacheFilesRemoved += 1;
    } catch {
      cacheErrors += 1;
    }
  }

  const {
    DownloadSession,
    MarketplaceDriveChange,
    MarketplaceDriveSyncState,
    MarketplaceReport,
    ModelDownload,
  } = data.modelsByName;
  const session = await marketplaceDbConnection().startSession();
  const deleted = {};
  try {
    await session.withTransaction(async () => {
      const stateQuery = data.rootFolderId
        ? { $or: [assetQuery, { rootFolderId: data.rootFolderId }] }
        : assetQuery;
      const results = await Promise.all([
        DownloadSession.deleteMany({ modelId: { $in: data.modelIds } }, { session }),
        ModelDownload.deleteMany({ modelId: { $in: data.modelIds } }, { session }),
        MarketplaceReport.deleteMany({ modelId: { $in: data.modelIds } }, { session }),
        MarketplaceDriveChange.deleteMany(stateQuery, { session }),
        MarketplaceDriveSyncState.deleteMany(stateQuery, { session }),
        MarketplaceModel.deleteMany(assetQuery, { session }),
      ]);
      [
        deleted.downloadSessions,
        deleted.modelDownloads,
        deleted.marketplaceReports,
        deleted.driveChanges,
        deleted.driveSyncStates,
        deleted.models,
      ] = results.map((result) => Number(result.deletedCount || 0));
    });
  } finally {
    await session.endSession();
  }

  const remaining = await MarketplaceModel.countDocuments(assetQuery);
  console.log(JSON.stringify({
    mode: "execute",
    backup,
    deleted,
    coverCache: { removed: cacheFilesRemoved, errors: cacheErrors },
    assetType: requestedAssetType,
    remainingAssets: remaining,
    untouched: {
      googleDriveFiles: true,
      otherAssetType: true,
      taxonomy: true,
      usersAndPayments: true,
    },
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
