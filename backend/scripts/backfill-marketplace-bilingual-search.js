import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import { finished } from "node:stream/promises";
import { closeDbConnections, connectDb } from "../src/config/db.js";
import { MARKETPLACE_CATEGORY_LABELS_VI } from "../src/data/marketplaceCategoryLabelsVi.js";
import { buildMarketplaceSearchDocument, MARKETPLACE_SEARCH_DOCUMENT_VERSION } from "../src/utils/marketplaceSearch.js";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const verifyOnly = args.has("--verify");
const batchArgument = process.argv.find((value) => value.startsWith("--batch="));
const batchSize = Math.min(2_000, Math.max(50, Number(batchArgument?.split("=")[1] || 500)));
const searchSchemaVersion = MARKETPLACE_SEARCH_DOCUMENT_VERSION;
const checkpointPath = path.resolve(".marketplace-bilingual-search-checkpoint.json");
const backupDir = path.resolve("backups");

function writeCheckpoint(value) {
  const tempPath = `${checkpointPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, checkpointPath);
}

function readCheckpoint() {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    if (Number(checkpoint.searchSchemaVersion || 0) === searchSchemaVersion) return checkpoint;
  } catch {
    // A missing or stale checkpoint starts a new versioned migration.
  }
  return { searchSchemaVersion, lastId: null, processed: 0, changed: 0 };
}

async function backupCurrentState(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `marketplace-bilingual-search-${stamp}.jsonl.gz`);
  const output = fs.createWriteStream(backupPath, { flags: "wx" });
  const gzip = createGzip({ level: 9 });
  gzip.pipe(output);
  const [categories, filterOptions] = await Promise.all([
    MarketplaceCategory.find({}).lean(),
    MarketplaceFilterOption.find({}).lean(),
  ]);
  gzip.write(`${JSON.stringify({ type: "taxonomy", categories, filterOptions })}\n`);
  const cursor = MarketplaceModel.find({})
    .select("_id searchVersion searchTitle searchTaxonomy searchTokens searchDocumentHash searchStatus searchIndexedAt searchError")
    .lean()
    .cursor();
  for await (const model of cursor) gzip.write(`${JSON.stringify({ type: "asset", model })}\n`);
  gzip.end();
  await finished(output);
  return backupPath;
}

async function translateSeededCategories(MarketplaceCategory) {
  let changed = 0;
  for (const [titleEn, titleVi] of Object.entries(MARKETPLACE_CATEGORY_LABELS_VI)) {
    const result = await MarketplaceCategory.updateMany(
      {
        assetType: { $in: ["model", null] },
        sourceProvider: "3dsky",
        $or: [{ titleEn }, { title: titleEn }],
      },
      {
        $set: { title: titleVi, titleEn },
        $setOnInsert: { aliasesVi: [], aliasesEn: [] },
      },
    );
    changed += Number(result.modifiedCount || 0);
  }
  return changed;
}

async function verify(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel) {
  const [activeCategories, missingVietnamese, activeFilters, missingFilterLabels, pending, errors, missingTokens, outdated, total] = await Promise.all([
    MarketplaceCategory.countDocuments({ isActive: { $ne: false } }),
    MarketplaceCategory.countDocuments({
      isActive: { $ne: false },
      $or: [{ title: "" }, { title: { $exists: false } }, { titleEn: "" }, { titleEn: { $exists: false } }],
    }),
    MarketplaceFilterOption.countDocuments({ isActive: { $ne: false } }),
    MarketplaceFilterOption.countDocuments({
      isActive: { $ne: false },
      $or: [{ labelVi: "" }, { labelVi: { $exists: false } }, { labelEn: "" }, { labelEn: { $exists: false } }],
    }),
    MarketplaceModel.countDocuments({ searchStatus: { $ne: "indexed" } }),
    MarketplaceModel.countDocuments({ searchStatus: "error" }),
    MarketplaceModel.countDocuments({ $or: [{ searchTokens: { $exists: false } }, { searchTokens: { $size: 0 } }] }),
    MarketplaceModel.countDocuments({ searchVersion: { $ne: MARKETPLACE_SEARCH_DOCUMENT_VERSION } }),
    MarketplaceModel.countDocuments({}),
  ]);
  return { activeCategories, missingVietnamese, activeFilters, missingFilterLabels, total, pending, errors, missingTokens, outdated };
}

async function replaceTextIndex(MarketplaceModel) {
  const indexes = await MarketplaceModel.collection.indexes();
  for (const index of indexes) {
    const isText = Object.values(index.key || {}).includes("text");
    if (isText && index.name !== "marketplace_model_bilingual_text") {
      await MarketplaceModel.collection.dropIndex(index.name);
    }
  }
  await MarketplaceModel.collection.createIndex(
    { searchTitle: "text", searchTaxonomy: "text", slug: "text" },
    {
      name: "marketplace_model_bilingual_text",
      default_language: "none",
      weights: { searchTitle: 10, searchTaxonomy: 6, slug: 2 },
    },
  );
  await MarketplaceModel.collection.createIndex(
    { assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, searchTokens: 1 },
    { name: "marketplace_model_hybrid_tokens" },
  );
}

async function main() {
  await connectDb();
  const [{ default: MarketplaceCategory }, { default: MarketplaceFilterOption }, { default: MarketplaceModel }] = await Promise.all([
    import("../src/models/MarketplaceCategory.js"),
    import("../src/models/MarketplaceFilterOption.js"),
    import("../src/models/MarketplaceModel.js"),
  ]);

  if (verifyOnly) {
    console.log(JSON.stringify({ mode: "verify", ...(await verify(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel)) }, null, 2));
    return;
  }
  if (!execute) {
    const result = await verify(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel);
    console.log(JSON.stringify({ mode: "dry-run", batchSize, ...result }, null, 2));
    return;
  }

  const checkpoint = readCheckpoint();
  if (!checkpoint.backupPath) {
    checkpoint.backupPath = await backupCurrentState(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel);
    writeCheckpoint(checkpoint);
  }
  checkpoint.translatedCategories = checkpoint.translatedCategories
    ?? await translateSeededCategories(MarketplaceCategory);
  await Promise.all([
    MarketplaceCategory.updateMany({ aliasesVi: { $exists: false } }, { $set: { aliasesVi: [] } }),
    MarketplaceCategory.updateMany({ aliasesEn: { $exists: false } }, { $set: { aliasesEn: [] } }),
    MarketplaceFilterOption.updateMany({ aliasesVi: { $exists: false } }, { $set: { aliasesVi: [] } }),
    MarketplaceFilterOption.updateMany({ aliasesEn: { $exists: false } }, { $set: { aliasesEn: [] } }),
  ]);
  writeCheckpoint(checkpoint);

  let lastId = checkpoint.lastId || null;
  while (true) {
    const rows = await MarketplaceModel.find(lastId ? { _id: { $gt: lastId } } : {})
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!rows.length) break;
    const operations = [];
    for (const row of rows) {
      const document = await buildMarketplaceSearchDocument(row);
      if (row.searchDocumentHash !== document.searchDocumentHash || row.searchStatus !== "indexed") {
        operations.push({
          updateOne: {
            filter: { _id: row._id },
            update: {
              $set: {
                ...document,
                searchStatus: "indexed",
                searchIndexedAt: new Date(),
                searchError: "",
              },
            },
          },
        });
      }
    }
    if (operations.length) await MarketplaceModel.bulkWrite(operations, { ordered: false });
    checkpoint.processed = Number(checkpoint.processed || 0) + rows.length;
    checkpoint.changed = Number(checkpoint.changed || 0) + operations.length;
    lastId = rows.at(-1)._id;
    checkpoint.lastId = String(lastId);
    writeCheckpoint(checkpoint);
    console.log(`Indexed ${checkpoint.changed} of ${checkpoint.processed} inspected assets.`);
  }

  await replaceTextIndex(MarketplaceModel);
  checkpoint.completedAt = new Date().toISOString();
  writeCheckpoint(checkpoint);
  console.log(JSON.stringify({ mode: "execute", ...checkpoint, ...(await verify(MarketplaceCategory, MarketplaceFilterOption, MarketplaceModel)) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
