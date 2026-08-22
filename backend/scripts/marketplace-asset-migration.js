import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";
import { useMemoryDb } from "../src/config/memoryStore.js";

const execute = process.argv.includes("--execute");
const memoryOnly = process.argv.includes("--memory");
const confirmation = "marketplace-asset-v1";

async function countMissing(Model, query) {
  return Model.countDocuments(query);
}

async function main() {
  if (execute && process.env.MIGRATION_CONFIRM !== confirmation) {
    throw new Error(`Set MIGRATION_CONFIRM=${confirmation} before executing this migration.`);
  }

  if (memoryOnly) {
    useMemoryDb();
  } else {
    await connectDb();
  }
  const [
    { default: MarketplaceCategory },
    { default: MarketplaceModel },
    { default: DownloadSession },
    { default: ModelDownload },
    { default: MarketplaceDriveChange },
    { default: MarketplaceDriveSyncState },
  ] = await Promise.all([
    import("../src/models/MarketplaceCategory.js"),
    import("../src/models/MarketplaceModel.js"),
    import("../src/models/DownloadSession.js"),
    import("../src/models/ModelDownload.js"),
    import("../src/models/MarketplaceDriveChange.js"),
    import("../src/models/MarketplaceDriveSyncState.js"),
  ]);

  const checks = {
    marketplaceModelsMissingAssetType: await countMissing(MarketplaceModel, { assetType: { $exists: false } }),
    marketplaceModelsMissingAssetId: await countMissing(MarketplaceModel, {
      $or: [{ "source.assetId": { $exists: false } }, { "source.assetId": "" }],
    }),
    categoriesMissingAssetType: await countMissing(MarketplaceCategory, { assetType: { $exists: false } }),
    sessionsMissingAssetType: await countMissing(DownloadSession, { assetType: { $exists: false } }),
    sessionsMissingQuotaCost: await countMissing(DownloadSession, { quotaCost: { $exists: false } }),
    sessionsMissingPaymentMethod: await countMissing(DownloadSession, { paymentMethod: { $exists: false } }),
    sessionsMissingPurgeAt: await countMissing(DownloadSession, {
      purgeAt: { $exists: false },
      expiresAt: { $type: "date" },
    }),
    downloadsMissingAssetType: await countMissing(ModelDownload, { assetType: { $exists: false } }),
    downloadsMissingQuotaCost: await countMissing(ModelDownload, { quotaCost: { $exists: false } }),
    downloadsMissingPaymentMethod: await countMissing(ModelDownload, { paymentMethod: { $exists: false } }),
    driveChangesMissingAssetType: await countMissing(MarketplaceDriveChange, { assetType: { $exists: false } }),
    driveStatesMissingAssetType: await countMissing(MarketplaceDriveSyncState, { assetType: { $exists: false } }),
  };

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    database: memoryOnly ? "memory" : "configured",
    checks,
  }, null, 2));
  if (!execute) {
    console.log(`Dry-run only. Review the counts, back up both databases, then set MIGRATION_CONFIRM=${confirmation}.`);
    return;
  }

  const { ensureMarketplaceAssetMigration } = await import("../src/utils/marketplaceMigration.js");
  await ensureMarketplaceAssetMigration();
  console.log("Marketplace asset migration completed.");
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
