import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const {
  createMarketplaceDownloadSession,
  markMarketplaceDownloadRedeemed,
} = await import("../src/utils/marketplaceDownloadService.js");

function requestFor(user) {
  return {
    user,
    ip: "127.0.0.71",
    get(name) {
      return String(name).toLowerCase() === "user-agent" ? "download-count-test" : "";
    },
  };
}

test("download count changes only when a session is redeemed for the first time", async () => {
  const user = await User.create({ email: "download-count@example.test", name: "Download count" });
  const model = await MarketplaceModel.create({
    assetType: "model",
    title: "Counted model",
    slug: "counted-model",
    categorySourceId: "arm-chair",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: "counted-drive-file",
    downloadCount: 0,
  });

  const created = await createMarketplaceDownloadSession({
    req: requestFor(user),
    modelId: model._id,
    expectedAssetType: "model",
  });

  assert.equal((await MarketplaceModel.findById(model._id)).downloadCount, 0);
  assert.equal((await ModelDownload.findOne({ sessionId: created.session._id })).status, "requested");

  const first = await markMarketplaceDownloadRedeemed(created.session);
  const retry = await markMarketplaceDownloadRedeemed(created.session);
  const updatedModel = await MarketplaceModel.findById(model._id);
  const download = await ModelDownload.findOne({ sessionId: created.session._id });

  assert.equal(first.counted, true);
  assert.equal(retry.counted, false);
  assert.equal(updatedModel.downloadCount, 1);
  assert.equal(download.status, "downloaded");
  assert.ok(download.downloadedAt);
});
