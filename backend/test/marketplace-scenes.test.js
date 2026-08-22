import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { createMarketplaceDownloadSession, verifyDownloadSession, vietnamDayKey } = await import("../src/utils/marketplaceDownloadService.js");
const { marketplaceMetadataDocument } = await import("../src/utils/marketplaceMetadata.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");
const { buildUserTimeline } = await import("../src/utils/timelineService.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { clearMarketplaceTaxonomyCache } = await import("../src/utils/marketplaceTaxonomy.js");

function requestFor(user, suffix = "default") {
  return {
    user,
    ip: `127.0.0.${suffix.length + 1}`,
    get(name) {
      return String(name).toLowerCase() === "user-agent" ? `scene-test-${suffix}` : "";
    },
  };
}

let sequence = 0;

async function createAsset(assetType = "scene") {
  sequence += 1;
  const isScene = assetType === "scene";
  return MarketplaceModel.create({
    assetType,
    title: `${isScene ? "Scene" : "Model"} ${sequence}`,
    slug: `${assetType}-${sequence}`,
    categoryId: `category-${assetType}`,
    styles: ["modern"],
    renderers: ["corona"],
    forms: isScene ? [] : ["rectangle"],
    colors: isScene ? [] : ["black"],
    materials: isScene ? [] : ["metal"],
    platforms: isScene ? ["3dsmax"] : [],
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: `drive-${assetType}-${sequence}`,
  });
}

test("scene metadata v3 allows empty optional facets, validates values and requires checksum", () => {
  const sha256 = "a".repeat(64);
  const valid = marketplaceMetadataDocument({
    assetType: "scene",
    sourceAssetId: "scene-000001",
    title: "Modern Living Room",
    sourceCategoryId: "living-room",
    accessType: "member",
    renderer: "Corona",
    renderers: ["corona"],
    styles: ["modern"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["wood"],
    platforms: ["3dsmax", "fbx/obj"],
    sha256,
  });

  assert.equal(valid.errors.length, 0);
  assert.equal(valid.document.schemaVersion, 3);
  assert.equal(valid.document.assetType, "scene");
  assert.deepEqual(valid.document.forms, []);
  assert.deepEqual(valid.document.colors, []);
  assert.deepEqual(valid.document.materials, []);
  assert.deepEqual(valid.document.platforms, ["3dsmax", "fbx-obj"]);

  const invalid = marketplaceMetadataDocument({
    assetType: "scene",
    sourceAssetId: "scene-000002",
    title: "Invalid Scene",
    sourceCategoryId: "living-room",
    accessType: "free",
    renderer: "",
    renderers: ["unknown-renderer"],
    styles: ["unknown-style"],
    platforms: ["unknown-platform"],
  });
  assert.ok(invalid.errors.some((error) => error.field === "render"));
  assert.ok(invalid.errors.some((error) => error.field === "style"));
  assert.ok(invalid.errors.some((error) => error.field === "platform"));
  assert.ok(invalid.errors.some((error) => error.field === "sha256"));

  const emptyOptionalFacets = marketplaceMetadataDocument({
    assetType: "scene",
    sourceAssetId: "scene-000003",
    title: "Unclassified Scene",
    sourceCategoryId: "living-room",
    accessType: "free",
    renderer: "",
    renderers: [],
    styles: [],
    sha256,
  });
  assert.deepEqual(emptyOptionalFacets.errors, []);
  assert.deepEqual(emptyOptionalFacets.document.platforms, []);
});

test("an unauthenticated visitor cannot create a Scene download session", async () => {
  const scene = await createAsset("scene");
  await assert.rejects(
    createMarketplaceDownloadSession({ req: requestFor(null, "anonymous"), modelId: scene._id, expectedAssetType: "scene" }),
    (error) => error?.status === 401 && error?.code === "AUTH_REQUIRED",
  );
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), tier: "guest" });
  assert.equal(quota, null);
});

test("a Free account can download one Scene and the second Scene is rejected", async () => {
  const user = await User.create({ email: "one-scene@example.test", name: "One scene" });
  const scene = await createAsset("scene");
  const req = requestFor(user, "free-one-scene");
  const result = await createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" });
  assert.equal(result.remaining, 0);
  await assert.rejects(
    createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" }),
    (error) => error?.status === 429 && error?.details?.required === 5 && error?.details?.remaining === 0,
  );
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota.count, 5);
});

test("concurrent Scene requests cannot exceed the account quota", async () => {
  const user = await User.create({ email: "concurrent-scenes@example.test", name: "Concurrent scenes" });
  const scene = await createAsset("scene");
  const req = requestFor(user, "concurrent-scenes");
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => (
    createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" })
  )));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.status === 429).length, 2);
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota.count, 5);
});

test("a Pro account with 100 downloads can create twenty Scene sessions", async () => {
  const user = await User.create({
    email: "twenty-scenes@example.test",
    name: "Twenty scenes",
    proUntil: new Date(Date.now() + 86_400_000),
    proDailyDownloadLimit: 100,
  });
  const scene = await createAsset("scene");
  const req = requestFor(user, "pro-twenty-scenes");
  for (let index = 0; index < 20; index += 1) {
    await createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" });
  }
  await assert.rejects(
    createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" }),
    (error) => error?.status === 429 && error?.details?.remaining === 0,
  );
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "member" });
  assert.equal(quota.count, 100);
});

test("daily Pro add-on quota is shared with Scene downloads", async () => {
  const user = await User.create({
    email: "scene-addon@example.test",
    name: "Scene add-on",
    proUntil: new Date(Date.now() + 86_400_000),
    proDailyDownloadLimit: 100,
  });
  await DailyDownloadQuota.create({
    dayKey: vietnamDayKey(),
    userId: user._id,
    guestKey: "",
    tier: "member",
    count: 100,
    bonusLimit: 50,
    resetAt: new Date(Date.now() + 86_400_000),
  });
  const scene = await createAsset("scene");
  const result = await createMarketplaceDownloadSession({
    req: requestFor(user, "scene-addon"),
    modelId: scene._id,
    expectedAssetType: "scene",
  });
  assert.equal(result.remaining, 45);
});

test("model and scene downloads share one quota record", async () => {
  const user = await User.create({
    email: "mixed-assets@example.test",
    name: "Mixed assets",
    proUntil: new Date(Date.now() + 86_400_000),
    proDailyDownloadLimit: 100,
  });
  const model = await createAsset("model");
  const scene = await createAsset("scene");
  const req = requestFor(user, "mixed-assets");
  for (let index = 0; index < 3; index += 1) {
    await createMarketplaceDownloadSession({ req, modelId: model._id, expectedAssetType: "model" });
  }
  await createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" });
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "member" });
  assert.equal(quota.count, 8);
});

test("a Scene is rejected without changing quota when only four downloads remain", async () => {
  const user = await User.create({ email: "four-remaining@example.test", name: "Four remaining" });
  const model = await createAsset("model");
  const scene = await createAsset("scene");
  const req = requestFor(user, "four-remaining");
  await createMarketplaceDownloadSession({ req, modelId: model._id, expectedAssetType: "model" });
  await assert.rejects(
    createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" }),
    (error) => error?.status === 429 && error?.details?.required === 5 && error?.details?.remaining === 4,
  );
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota.count, 1);
});

test("a failed scene session restores all five charged downloads", async () => {
  const user = await User.create({ email: "scene-rollback@example.test", name: "Scene rollback" });
  const scene = await createAsset("scene");
  const originalCreate = ModelDownload.create;
  ModelDownload.create = async () => {
    throw new Error("simulated scene log failure");
  };
  try {
    await assert.rejects(
      createMarketplaceDownloadSession({ req: requestFor(user, "scene-rollback"), modelId: scene._id, expectedAssetType: "scene" }),
      /simulated scene log failure/,
    );
  } finally {
    ModelDownload.create = originalCreate;
  }
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota.count, 0);
});

test("retrying the same Scene download session does not charge quota again", async () => {
  const user = await User.create({ email: "scene-retry@example.test", name: "Scene retry" });
  const scene = await createAsset("scene");
  const req = requestFor(user, "scene-retry");
  const result = await createMarketplaceDownloadSession({ req, modelId: scene._id, expectedAssetType: "scene" });
  await verifyDownloadSession(result.session._id, result.token);
  await verifyDownloadSession(result.session._id, result.token);
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota.count, 5);
});

test("model endpoint cannot create a download session for a scene", async () => {
  const user = await User.create({ email: "cross-catalog@example.test", name: "Cross catalog" });
  const scene = await createAsset("scene");
  await assert.rejects(
    createMarketplaceDownloadSession({ req: requestFor(user, "cross-catalog"), modelId: scene._id, expectedAssetType: "model" }),
    (error) => error?.status === 404,
  );
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "free" });
  assert.equal(quota, null);
});

test("public Model and Scene lists never mix catalogs", async () => {
  await createAsset("model");
  await createAsset("scene");
  let modelPayload;
  let scenePayload;
  await listMarketplaceModels(
    { query: {} },
    { json(value) { modelPayload = value; return value; } },
    (error) => { throw error; },
  );
  await listMarketplaceModels(
    { query: {}, marketplaceAssetType: "scene" },
    { json(value) { scenePayload = value; return value; } },
    (error) => { throw error; },
  );

  assert.ok(modelPayload.models.every((asset) => asset.assetType === "model"));
  assert.ok(scenePayload.scenes.every((asset) => asset.assetType === "scene"));
  assert.equal(JSON.stringify(scenePayload).includes("driveFileId"), false);
});

test("Scene parent category includes all children while a child category stays exact", async () => {
  await initializeMarketplaceCategories();
  const parent = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "house-space" });
  const livingRoom = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "living-room" });
  const bedroom = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "bedroom" });
  const livingScene = await createAsset("scene");
  const bedroomScene = await createAsset("scene");
  await MarketplaceModel.findByIdAndUpdate(livingScene._id, { $set: { categoryId: livingRoom._id, parentCategoryId: parent._id } });
  await MarketplaceModel.findByIdAndUpdate(bedroomScene._id, { $set: { categoryId: bedroom._id, parentCategoryId: parent._id } });

  let parentPayload;
  let childPayload;
  await listMarketplaceModels(
    { query: { category: "house-space" }, marketplaceAssetType: "scene" },
    { json(value) { parentPayload = value; return value; } },
    (error) => { throw error; },
  );
  await listMarketplaceModels(
    { query: { category: "living-room" }, marketplaceAssetType: "scene" },
    { json(value) { childPayload = value; return value; } },
    (error) => { throw error; },
  );

  assert.ok(parentPayload.scenes.some((scene) => String(scene._id) === String(livingScene._id)));
  assert.ok(parentPayload.scenes.some((scene) => String(scene._id) === String(bedroomScene._id)));
  assert.ok(childPayload.scenes.some((scene) => String(scene._id) === String(livingScene._id)));
  assert.equal(childPayload.scenes.some((scene) => String(scene._id) === String(bedroomScene._id)), false);

  await MarketplaceCategory.findByIdAndUpdate(bedroom._id, { $set: { isActive: false } });
  clearMarketplaceTaxonomyCache();
  let activeParentPayload;
  await listMarketplaceModels(
    { query: { category: "house-space" }, marketplaceAssetType: "scene" },
    { json(value) { activeParentPayload = value; return value; } },
    (error) => { throw error; },
  );
  assert.ok(activeParentPayload.scenes.some((scene) => String(scene._id) === String(livingScene._id)));
  assert.equal(activeParentPayload.scenes.some((scene) => String(scene._id) === String(bedroomScene._id)), false);
});

test("user history reports Scene and the exact five-download cost", async () => {
  const user = await User.create({ email: "scene-history@example.test", name: "Scene history" });
  const scene = await createAsset("scene");
  await createMarketplaceDownloadSession({ req: requestFor(user, "scene-history"), modelId: scene._id, expectedAssetType: "scene" });
  const timeline = await buildUserTimeline({ userId: user._id, type: "scene", page: 1, limit: 20 });

  assert.equal(timeline.pagination.total, 1);
  assert.equal(timeline.events[0].type, "scene");
  assert.equal(timeline.events[0].amount, -5);
  assert.equal(timeline.events[0].metadata.quotaCost, 5);
});
