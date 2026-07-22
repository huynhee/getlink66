import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";

async function main() {
  await connectDb();
  const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
  const { default: DownloadSession } = await import("../src/models/DownloadSession.js");
  const { default: ModelDownload } = await import("../src/models/ModelDownload.js");

  const demoAssets = await MarketplaceModel.find({ "source.provider": "demo" })
    .select("_id assetType")
    .lean();
  const assetIds = demoAssets.map((asset) => asset._id);
  const counts = demoAssets.reduce((result, asset) => {
    result[asset.assetType === "scene" ? "scenes" : "models"] += 1;
    return result;
  }, { models: 0, scenes: 0 });

  let sessions = 0;
  let downloads = 0;
  if (assetIds.length) {
    const sessionResult = await DownloadSession.deleteMany({ modelId: { $in: assetIds } });
    const downloadResult = await ModelDownload.deleteMany({ modelId: { $in: assetIds } });
    sessions = sessionResult.deletedCount || 0;
    downloads = downloadResult.deletedCount || 0;
  }
  const assetResult = await MarketplaceModel.deleteMany({ "source.provider": "demo" });
  const [remainingModels, remainingScenes, remainingDemoAssets] = await Promise.all([
    MarketplaceModel.countDocuments({ assetType: { $ne: "scene" } }),
    MarketplaceModel.countDocuments({ assetType: "scene" }),
    MarketplaceModel.countDocuments({ "source.provider": "demo" }),
  ]);

  console.log(JSON.stringify({
    removed: {
      assets: assetResult.deletedCount || 0,
      models: counts.models,
      scenes: counts.scenes,
      downloadSessions: sessions,
      downloadHistory: downloads,
    },
    remaining: {
      models: remainingModels,
      scenes: remainingScenes,
      demoAssets: remainingDemoAssets,
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
