import "dotenv/config";
import { connectDb, closeDbConnections, marketplaceDbConnection } from "../src/config/db.js";
import { ADMIN_ASSET_INDEX, ADMIN_ASSET_INDEX_KEY } from "../src/utils/marketplaceAdminListing.js";

const apply = process.argv.includes("--apply");
await connectDb();
try {
  const collection = marketplaceDbConnection().collection("marketplacemodels");
  const indexes = await collection.listIndexes().toArray();
  const existing = indexes.find((index) => index.name === ADMIN_ASSET_INDEX);
  if (existing && JSON.stringify(existing.key) !== JSON.stringify(ADMIN_ASSET_INDEX_KEY)) {
    throw new Error("The admin index name already exists with a different key. No index was changed.");
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", name: ADMIN_ASSET_INDEX, key: ADMIN_ASSET_INDEX_KEY, exists: Boolean(existing) }));
  if (apply && !existing) {
    await collection.createIndex(ADMIN_ASSET_INDEX_KEY, { name: ADMIN_ASSET_INDEX, maxTimeMS: 120_000 });
    console.log("Admin read index created; no documents or existing indexes were changed.");
  }
} finally {
  await closeDbConnections();
}
