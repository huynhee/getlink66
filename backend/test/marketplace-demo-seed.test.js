import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { seedMarketplaceDemoModels } = await import("../src/utils/marketplaceDemoSeed.js");
const { openDemoMarketplaceImageStream } = await import("../src/utils/storageProvider.js");

test("demo seed creates a complete 61-model catalog without real download files", async () => {
  await initializeMarketplaceCategories();
  const result = await seedMarketplaceDemoModels();
  const models = await MarketplaceModel.find({ "source.provider": "demo" });
  const image = openDemoMarketplaceImageStream();

  assert.equal(result.created, 61);
  assert.equal(models.length, 61);
  assert.ok(models.every((model) => model.isPublished && model.fileStatus === "ready"));
  assert.ok(models.every((model) => String(model.coverImage?.driveFileId || "").startsWith("demo:")));
  assert.ok(models.every((model) => model.previewImages?.length === 4));
  assert.ok(models.every((model) => String(model.previewImages?.[0]?.driveFileId || "").includes(":preview:")));
  assert.ok(image.contentLength > 0);
  image.stream.destroy();
});
