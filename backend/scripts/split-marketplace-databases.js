import "dotenv/config";
import {
  closeDbConnections,
  connectDb,
  coreDbConnection,
  marketplaceDbConnection,
  marketplaceDbIsDistinct,
  marketplaceDbUsesCore,
} from "../src/config/db.js";
import { normalizeMarketplaceTitle } from "../src/utils/marketplaceSort.js";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute") || args.has("--finalize");
const finalize = args.has("--finalize");
const reset = args.has("--reset");
const batchArgument = process.argv.find((value) => value.startsWith("--batch="));
const batchSize = Math.min(5000, Math.max(10, Number(batchArgument?.split("=")[1] || 500)));
const CHECKPOINT_COLLECTION = "marketplaceMigrationCheckpoints";

function assertMigrationWindow() {
  if (!execute) return;
  if (process.env.MIGRATION_WRITES_FROZEN !== "true") {
    throw new Error("Set MIGRATION_WRITES_FROZEN=true after placing the application in maintenance mode.");
  }
  const verifiedAt = new Date(process.env.MIGRATION_BACKUP_VERIFIED_AT || "");
  if (Number.isNaN(verifiedAt.getTime()) || Date.now() - verifiedAt.getTime() > 26 * 60 * 60 * 1000) {
    throw new Error("MIGRATION_BACKUP_VERIFIED_AT must reference a verified backup from the last 26 hours.");
  }
}

const COLLECTIONS = [
  "marketplacemodels",
  "modeldownloads",
  "downloadsessions",
  "dailydownloadquotas",
  "dailyimagesearchquotas",
  "marketplacedrivechanges",
  "marketplacedrivesyncstates",
  "productcaches",
  "systemlogs",
  "auditlogs",
  "notifications",
  "notificationreceipts",
  "marketplacequotagrants",
  "marketplacereports",
  "historyarchivemanifests",
];

function valueId(value) {
  return String(value?._id || value || "");
}

function sevenDaysAfter(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
}

async function categoryMap() {
  const categories = await coreDbConnection().collection("marketplacecategories").find({}).toArray();
  const byId = new Map(categories.map((item) => [valueId(item._id), item]));
  return { categories, byId };
}

async function migrateCoreOwnedData() {
  if (marketplaceDbUsesCore()) return { categories: 0, filterOptions: 0, guideArticles: 0 };
  const core = coreDbConnection();
  const source = marketplaceDbConnection();
  const categoryRows = await source.collection("marketplacecategories").find({}).toArray();
  const sourceCategoryById = new Map(categoryRows.map((row) => [valueId(row._id), row]));
  const categoryIdMap = new Map();
  let categories = 0;
  let pending = [...categoryRows];
  while (pending.length) {
    let progressed = false;
    const next = [];
    for (const row of pending) {
      const oldParentId = valueId(row.parentId);
      if (oldParentId && sourceCategoryById.has(oldParentId) && !categoryIdMap.has(oldParentId)) {
        next.push(row);
        continue;
      }
      const key = {
        assetType: row.assetType === "scene" ? "scene" : "model",
        sourceProvider: String(row.sourceProvider || "3dsky"),
        sourceCategoryId: String(row.sourceCategoryId || row.slug || ""),
      };
      if (!key.sourceCategoryId) continue;
      let existing = await core.collection("marketplacecategories").findOne(key);
      if (!existing) {
        const payload = { ...row, ...key };
        delete payload._id;
        payload.parentId = oldParentId ? categoryIdMap.get(oldParentId) || null : null;
        payload.parentSourceCategoryId = String(
          row.parentSourceCategoryId || sourceCategoryById.get(oldParentId)?.sourceCategoryId || "",
        );
        const inserted = await core.collection("marketplacecategories").insertOne(payload);
        existing = { ...payload, _id: inserted.insertedId };
        categories += 1;
      }
      categoryIdMap.set(valueId(row._id), existing._id);
      progressed = true;
    }
    if (!progressed) {
      throw new Error(`Marketplace category tree contains ${next.length} orphaned or cyclic row(s).`);
    }
    pending = next;
  }

  let filterOptions = 0;
  const filterRows = await source.collection("marketplacefilteroptions").find({}).toArray();
  for (const row of filterRows) {
    const key = {
      assetType: row.assetType === "scene" ? "scene" : "model",
      facet: String(row.facet || ""),
      value: String(row.value || "").toLowerCase(),
    };
    if (!key.facet || !key.value) continue;
    if (await core.collection("marketplacefilteroptions").findOne(key)) continue;
    const payload = { ...row, ...key };
    delete payload._id;
    await core.collection("marketplacefilteroptions").insertOne(payload);
    filterOptions += 1;
  }

  let guideArticles = 0;
  const guideRows = await source.collection("guidearticles").find({}).toArray();
  for (const row of guideRows) {
    const identity = row.slug ? { slug: row.slug } : { _id: row._id };
    if (await core.collection("guidearticles").findOne(identity)) continue;
    const payload = { ...row };
    if (row.slug) delete payload._id;
    await core.collection("guidearticles").insertOne(payload);
    guideArticles += 1;
  }
  return { categories, filterOptions, guideArticles };
}

function transformModel(document, categories) {
  const next = { ...document, ...(document.source ? { source: { ...document.source } } : {}) };
  next.assetType = next.assetType === "scene" ? "scene" : "model";
  const category = categories.byId.get(valueId(next.categoryId));
  const parent = categories.byId.get(valueId(next.parentCategoryId || category?.parentId));
  next.categorySourceId = String(next.categorySourceId || category?.sourceCategoryId || next.source?.categoryId || "");
  next.parentCategorySourceId = String(next.parentCategorySourceId || parent?.sourceCategoryId || category?.parentSourceCategoryId || "");
  if (next.source) {
    delete next.source.raw;
    delete next.source.url;
    next.source.assetId = String(next.source.assetId || next.source.modelId || "");
  }
  delete next.categoryId;
  delete next.parentCategoryId;
  delete next.description;
  delete next.tags;
  delete next.creditPrice;
  next.titleSort = normalizeMarketplaceTitle(next.title);
  next.downloadCount = Number(next.downloadCount || 0);
  return next;
}

function transformSession(document) {
  const next = { ...document };
  next.assetType = next.assetType === "scene" ? "scene" : "model";
  next.quotaCost = next.quotaCost == null ? (next.quotaCharged ? (next.assetType === "scene" ? 5 : 1) : 0) : Number(next.quotaCost);
  next.purgeAt = next.purgeAt || sevenDaysAfter(next.expiresAt);
  if (next.status === "used" && !next.downloadCountedAt) {
    next.downloadCountedAt = next.downloadedAt || next.updatedAt || next.createdAt;
    next.downloadedAt = next.downloadedAt || next.downloadCountedAt;
  }
  return next;
}

function transformDownload(document, sessions) {
  const next = { ...document };
  next.assetType = next.assetType === "scene" ? "scene" : "model";
  next.quotaCost = next.quotaCost == null ? (next.quotaCharged ? (next.assetType === "scene" ? 5 : 1) : 0) : Number(next.quotaCost);
  const session = sessions.get(valueId(next.sessionId));
  const downloadedAt = next.downloadedAt || session?.downloadedAt || session?.downloadCountedAt || (session?.status === "used" ? session.updatedAt : null);
  next.status = downloadedAt ? "downloaded" : (next.status || "requested");
  if (downloadedAt) next.downloadedAt = downloadedAt;
  return next;
}

function transformDocument(collectionName, document, context) {
  if (collectionName === "marketplacemodels") return transformModel(document, context.categories);
  if (collectionName === "downloadsessions") return transformSession(document);
  if (collectionName === "modeldownloads") return transformDownload(document, context.sessions);
  const next = { ...document };
  if (["marketplacedrivechanges", "marketplacedrivesyncstates"].includes(collectionName)) {
    next.assetType = next.assetType === "scene" ? "scene" : "model";
  }
  return next;
}

async function checkpoint(collectionName) {
  return marketplaceDbConnection().collection(CHECKPOINT_COLLECTION).findOne({ collectionName });
}

async function copyCollection(collectionName, context) {
  const source = coreDbConnection().collection(collectionName);
  const target = marketplaceDbConnection().collection(collectionName);
  if (reset) await marketplaceDbConnection().collection(CHECKPOINT_COLLECTION).deleteOne({ collectionName });
  let state = await checkpoint(collectionName);
  let lastId = state?.lastId || null;
  let copied = Number(state?.copied || 0);
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const documents = await source.find(query).sort({ _id: 1 }).limit(batchSize).toArray();
    if (!documents.length) break;
    if (collectionName === "modeldownloads") {
      const sessionIds = [...new Set(documents.map((item) => item.sessionId).filter(Boolean))];
      const sessionRows = sessionIds.length
        ? await coreDbConnection().collection("downloadsessions").find({ _id: { $in: sessionIds } }).toArray()
        : [];
      context.sessions = new Map(sessionRows.map((item) => [valueId(item._id), item]));
    }
    const transformed = documents.map((document) => transformDocument(collectionName, document, context));
    await target.bulkWrite(transformed.map((document) => ({
      replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true },
    })), { ordered: false });
    lastId = documents.at(-1)._id;
    copied += documents.length;
    await marketplaceDbConnection().collection(CHECKPOINT_COLLECTION).updateOne(
      { collectionName },
      { $set: { collectionName, lastId, copied, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    console.log(`${collectionName}: copied ${copied}`);
  }
  const [sourceCount, targetCount] = await Promise.all([source.countDocuments(), target.countDocuments()]);
  if (targetCount !== sourceCount) {
    throw new Error(
      `${collectionName}: verification failed; source and target counts differ (${sourceCount}/${targetCount}). Freeze writes and reconcile the target before retrying.`,
    );
  }
  return { collectionName, sourceCount, targetCount, copied };
}

async function recalculateDownloadCounts() {
  const target = marketplaceDbConnection();
  await target.collection("marketplacemodels").updateMany({}, { $set: { downloadCount: 0 } });
  const cursor = target.collection("modeldownloads").aggregate([
    { $match: { status: "downloaded" } },
    { $group: { _id: "$modelId", count: { $sum: 1 } } },
  ]);
  let updated = 0;
  for await (const row of cursor) {
    await target.collection("marketplacemodels").updateOne({ _id: row._id }, { $set: { downloadCount: row.count } });
    updated += 1;
  }
  return updated;
}

async function ensureTargetIndexes() {
  const modules = [
    "MarketplaceModel", "ModelDownload", "DownloadSession", "DailyDownloadQuota",
    "DailyImageSearchQuota", "MarketplaceDriveChange", "MarketplaceDriveSyncState",
    "ProductCache", "SystemLog", "AuditLog", "Notification", "NotificationReceipt",
    "MarketplaceQuotaGrant", "HistoryArchiveManifest", "MarketplaceReport",
  ];
  const models = await Promise.all(modules.map(async (name) =>
    (await import(`../src/models/${name}.js`)).default,
  ));
  await Promise.all(models.map((model) => model.createIndexes()));
}

async function ensureCoreOwnedIndexes() {
  const modules = ["MarketplaceCategory", "MarketplaceFilterOption", "GuideArticle"];
  const models = await Promise.all(modules.map(async (name) =>
    (await import(`../src/models/${name}.js`)).default,
  ));
  await Promise.all(models.map((model) => model.createIndexes()));
}

async function finalizeSource(results) {
  if (process.env.MIGRATION_CONFIRM !== "split-marketplace-data") {
    throw new Error("Set MIGRATION_CONFIRM=split-marketplace-data before --finalize.");
  }
  const purchases = await coreDbConnection().collection("modelpurchases").countDocuments();
  if (purchases > 0) throw new Error(`ModelPurchase still contains ${purchases} record(s); finalize was refused.`);
  for (const result of results) {
    if (result.targetCount !== result.sourceCount) throw new Error(`${result.collectionName} was not fully verified.`);
  }
  for (const collectionName of COLLECTIONS) {
    await coreDbConnection().collection(collectionName).deleteMany({});
  }
  await coreDbConnection().collection("modelpurchases").drop().catch((error) => {
    if (Number(error?.code) !== 26) throw error;
  });
  for (const collectionName of ["marketplacecategories", "marketplacefilteroptions", "guidearticles"]) {
    await marketplaceDbConnection().collection(collectionName).deleteMany({});
  }
}

assertMigrationWindow();
await connectDb();
try {
  let coreOwnedMigration = { categories: 0, filterOptions: 0, guideArticles: 0 };
  if (execute) {
    if (marketplaceDbUsesCore() || !marketplaceDbIsDistinct()) {
      throw new Error("MONGO_MARKETPLACE_URI must point to a distinct VPS database for execution.");
    }
    coreOwnedMigration = await migrateCoreOwnedData();
    const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
    await initializeMarketplaceCategories();
    await ensureCoreOwnedIndexes();
  }
  const context = { categories: await categoryMap(), sessions: new Map() };
  const counts = [];
  for (const collectionName of COLLECTIONS) {
    const sourceCount = await coreDbConnection().collection(collectionName).countDocuments();
    const targetCount = marketplaceDbUsesCore()
      ? sourceCount
      : await marketplaceDbConnection().collection(collectionName).countDocuments();
    counts.push({ collectionName, sourceCount, targetCount });
  }
  const purchaseCount = await coreDbConnection().collection("modelpurchases").countDocuments();
  console.table(counts);
  console.log(`Atlas taxonomy categories: ${context.categories.categories.length}`);
  console.log(`Legacy ModelPurchase rows: ${purchaseCount}`);
  if (execute) console.log("Core-owned rows migrated from VPS:", coreOwnedMigration);
  if (!execute) {
    console.log("Dry-run only. Re-run with --execute after configuring MONGO_MARKETPLACE_URI.");
    process.exitCode = 0;
  } else {
    await ensureTargetIndexes();
    const results = [];
    for (const collectionName of COLLECTIONS) results.push(await copyCollection(collectionName, context));
    const countedModels = await recalculateDownloadCounts();
    console.log(`Recalculated cumulative downloadCount for ${countedModels} assets.`);
    if (finalize) await finalizeSource(results);
    console.table(results);
    console.log(finalize ? "Migration finalized; moved collections were removed from Atlas." : "Copy and verification complete; Atlas source data was retained.");
  }
} finally {
  await closeDbConnections();
}
