import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import DownloadSession from "../models/DownloadSession.js";
import ModelDownload from "../models/ModelDownload.js";
import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import { isMemoryDb } from "../config/memoryStore.js";
import logger from "./logger.js";

async function dropIndexIfPresent(model, name) {
  try {
    await model.collection.dropIndex(name);
  } catch (error) {
    if (![26, 27].includes(Number(error?.code)) && !/index not found/i.test(String(error?.message || ""))) throw error;
  }
}

export async function ensureMarketplaceAssetMigration() {
  if (isMemoryDb()) return;
  await MarketplaceModel.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });
  await MarketplaceModel.updateMany(
    { $or: [{ "source.assetId": { $exists: false } }, { "source.assetId": "" }] },
    [{ $set: { "source.assetId": { $ifNull: ["$source.modelId", ""] } } }],
  );
  await MarketplaceModel.updateMany(
    { $or: [{ sourceAssetIdSort: { $exists: false } }, { sourceAssetIdSort: 0 }] },
    [{
      $set: {
        sourceAssetIdSort: {
          $convert: {
            input: { $ifNull: ["$source.assetId", "$metadataSourceModelId"] },
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
      },
    }],
  );
  await MarketplaceCategory.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });
  await DownloadSession.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });
  await DownloadSession.updateMany(
    { quotaCost: { $exists: false } },
    [{ $set: { quotaCost: { $cond: ["$quotaCharged", 1, 0] } } }],
  );
  await DownloadSession.updateMany(
    { paymentMethod: { $exists: false } },
    [{
      $set: {
        paymentMethod: { $cond: [{ $eq: ["$accessTier", "member"] }, "pro_quota", "free_quota"] },
        billingStatus: "not_applicable",
        creditCost: 0,
      },
    }],
  );
  await DownloadSession.updateMany(
    { purgeAt: { $exists: false }, expiresAt: { $type: "date" } },
    [{ $set: { purgeAt: { $add: ["$expiresAt", 7 * 24 * 60 * 60 * 1000] } } }],
  );
  await ModelDownload.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });
  await ModelDownload.updateMany(
    { quotaCost: { $exists: false } },
    [{ $set: { quotaCost: { $cond: ["$quotaCharged", 1, 0] } } }],
  );
  await ModelDownload.updateMany(
    { paymentMethod: { $exists: false } },
    [{
      $set: {
        paymentMethod: { $cond: [{ $eq: ["$accessTier", "member"] }, "pro_quota", "free_quota"] },
        billingStatus: "not_applicable",
        creditCost: 0,
      },
    }],
  );
  await MarketplaceDriveChange.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });
  await MarketplaceDriveSyncState.updateMany({ assetType: { $exists: false } }, { $set: { assetType: "model" } });

  await dropIndexIfPresent(MarketplaceModel, "slug_1");
  await dropIndexIfPresent(MarketplaceModel, "source.provider_1_source.modelId_1");
  await dropIndexIfPresent(MarketplaceCategory, "sourceProvider_1_sourceCategoryId_1");
  const modelIndexes = await MarketplaceModel.collection.indexes();
  const hasLegacyTextIndex = modelIndexes.some((index) => index.name === "marketplace_model_text");
  if (hasLegacyTextIndex) {
    logger.warn("Legacy marketplace text index is still active; run marketplace:search:execute to replace it safely");
    await Promise.all([
      MarketplaceCategory.createIndexes(),
      DownloadSession.createIndexes(),
      ModelDownload.createIndexes(),
    ]);
  } else {
    await Promise.all([
      MarketplaceModel.createIndexes(),
      MarketplaceCategory.createIndexes(),
      DownloadSession.createIndexes(),
      ModelDownload.createIndexes(),
    ]);
  }
  logger.info("Marketplace asset migration and indexes are ready");
}
