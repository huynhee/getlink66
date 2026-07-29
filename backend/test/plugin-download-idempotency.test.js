import assert from "node:assert/strict";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { createMarketplaceDownloadSession, vietnamDayKey } = await import(
  "../src/utils/marketplaceDownloadService.js"
);

function pluginRequest(user, key) {
  return {
    user,
    ip: "127.0.0.1",
    get(name) {
      if (name.toLowerCase() === "idempotency-key") return key;
      if (name.toLowerCase() === "user-agent") return "3DiPL-test";
      return "";
    },
  };
}

test("plugin idempotency returns one session and charges model quota once", async () => {
  const user = await User.create({
    email: "plugin-download@example.test",
    name: "Plugin Download",
  });
  const model = await MarketplaceModel.create({
    assetType: "model",
    title: "Chair",
    slug: "chair",
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    accessType: "free",
    source: { provider: "google_drive" },
    storageProvider: "google_drive",
    storageKey: "asset/chair.zip",
    driveFileId: "drive-chair",
    archiveExt: "zip",
    fileSize: 100,
    sha256: "a".repeat(64),
    mainMaxFile: "chair.max",
  });
  const req = pluginRequest(user, "operation-model-0001");
  const first = await createMarketplaceDownloadSession({
    req,
    modelId: model._id,
    clientType: "plugin",
    expectedAssetType: "model",
  });
  const second = await createMarketplaceDownloadSession({
    req,
    modelId: model._id,
    clientType: "plugin",
    expectedAssetType: "model",
  });

  assert.equal(String(first.session._id), String(second.session._id));
  assert.equal(first.downloadUrl, second.downloadUrl);
  assert.match(first.downloadUrl, /^\/api\/plugin\/download\/session\//);
  assert.equal(first.session.assetRevision, `${"a".repeat(64)}:100`);
  assert.equal(first.session.mainMaxFile, "chair.max");
  const quota = await DailyDownloadQuota.findOne({
    dayKey: vietnamDayKey(),
    tier: "free",
    userId: user._id,
  });
  assert.equal(quota.count, 1);
});
