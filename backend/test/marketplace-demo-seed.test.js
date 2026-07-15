import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { seedMarketplaceDemoModels, seedMarketplaceDemoScenes } = await import("../src/utils/marketplaceDemoSeed.js");
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

test("demo seed creates a separate Scene catalog", async () => {
  await initializeMarketplaceCategories();
  const result = await seedMarketplaceDemoScenes();
  const scenes = await MarketplaceModel.find({ assetType: "scene", "source.provider": "demo" });

  assert.equal(result.created, 18);
  assert.equal(scenes.length, 18);
  assert.ok(scenes.every((scene) => scene.assetType === "scene"));
  assert.ok(scenes.every((scene) => scene.forms.length === 0 && scene.colors.length === 0 && scene.materials.length === 0));
  assert.ok(scenes.every((scene) => scene.previewImages?.[0]?.fileName === "preview-1.jpg"));
});

test("Scene category seed is idempotent and keeps the parent-child tree", async () => {
  await initializeMarketplaceCategories();
  const before = await MarketplaceCategory.countDocuments({ assetType: "scene" });
  await initializeMarketplaceCategories();
  const after = await MarketplaceCategory.countDocuments({ assetType: "scene" });
  const livingRoom = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "living-room" });
  const houseSpace = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "house-space" });

  assert.equal(after, before);
  assert.equal(String(livingRoom.parentId), String(houseSpace._id));
});
