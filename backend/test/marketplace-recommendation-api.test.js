import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: MarketplaceInterestProfile } = await import("../src/models/MarketplaceInterestProfile.js");
const { invalidateMarketplaceHomeRecommendations } = await import(
  "../src/utils/marketplaceRecommendationService.js"
);
const {
  getMarketplaceModel,
  listMarketplaceHomeRecommendations,
  listMarketplaceModelRecommendations,
} = await import("../src/controllers/marketplaceController.js");

function responseCapture() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    response: {
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(value) {
        state.body = value;
        return value;
      },
    },
  };
}

test("model detail returns six recommendations and expansion returns the next 54", async () => {
  await MarketplaceModel.create({
    source: { provider: "drive", modelId: "recommendation-source" },
    title: "Source chair",
    slug: "source-chair",
    categoryId: "chairs",
    parentCategoryId: "furniture",
    renderer: "Corona",
    renderers: ["corona"],
    styles: ["modern"],
    forms: ["organic"],
    colors: ["beige"],
    materials: ["fabric"],
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  await MarketplaceModel.insertMany(Array.from({ length: 75 }, (_, index) => ({
    source: { provider: "drive", modelId: `recommendation-${index}` },
    title: `Recommended chair ${index + 1}`,
    slug: `recommended-chair-${index + 1}`,
    categoryId: "chairs",
    parentCategoryId: "furniture",
    renderer: index % 2 ? "Vray" : "Corona",
    renderers: [index % 2 ? "vray" : "corona"],
    styles: ["modern"],
    forms: ["organic"],
    colors: ["beige"],
    materials: ["fabric"],
    accessType: index % 5 ? "member" : "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    downloadCount: index,
  })));

  const detail = responseCapture();
  await getMarketplaceModel(
    { params: { slug: "source-chair" } },
    detail.response,
    (error) => { throw error; },
  );
  assert.equal(detail.state.statusCode, 200);
  assert.equal(detail.state.body.recommendedModels.length, 6);
  assert.ok(detail.state.body.recommendedModels.every((item) => item.accessType === "member"));
  assert.equal(detail.state.body.recommendations.total, 60);
  assert.equal(detail.state.body.recommendations.hasMore, true);

  const expanded = responseCapture();
  await listMarketplaceModelRecommendations(
    { params: { slug: "source-chair" }, query: { offset: "6", limit: "54" } },
    expanded.response,
    (error) => { throw error; },
  );
  assert.equal(expanded.state.statusCode, 200);
  assert.equal(expanded.state.body.models.length, 54);
  assert.ok(expanded.state.body.models.every((item) => item.accessType === "member"));
  assert.equal(expanded.state.body.pagination.total, 60);
  assert.equal(expanded.state.body.pagination.hasMore, false);
});

test("model detail can defer recommendations for a faster first render", async () => {
  const detail = responseCapture();
  await getMarketplaceModel(
    {
      params: { slug: "source-chair" },
      query: { includeRecommendations: "false" },
    },
    detail.response,
    (error) => { throw error; },
  );

  assert.equal(detail.state.statusCode, 200);
  assert.equal(detail.state.body.model.slug, "source-chair");
  assert.deepEqual(detail.state.body.recommendedModels, []);
  assert.equal(detail.state.body.recommendations.deferred, true);
});

test("home recommendations personalize from downloads and keep asset types separate", async () => {
  await Promise.all([
    MarketplaceModel.deleteMany({}),
    ModelDownload.deleteMany({}),
  ]);
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const downloaded = await MarketplaceModel.create({
    assetType: "model",
    source: { provider: "drive", modelId: "home-downloaded", assetId: "home-downloaded" },
    title: "Downloaded lounge seat",
    slug: "home-downloaded",
    categorySourceId: "home-lounge",
    parentCategorySourceId: "home-furniture",
    styles: ["modern"],
    renderers: ["corona"],
    renderer: "Corona",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  await ModelDownload.create({
    assetType: "model",
    modelId: downloaded._id,
    userId,
    status: "downloaded",
    downloadedAt: new Date(),
  });
  invalidateMarketplaceHomeRecommendations(userId);
  const preferred = await MarketplaceModel.create({
    assetType: "model",
    source: { provider: "drive", modelId: "home-preferred", assetId: "home-preferred" },
    title: "Relevant lounge chair",
    slug: "home-preferred",
    categorySourceId: "home-lounge",
    parentCategorySourceId: "home-furniture",
    styles: ["modern"],
    renderers: ["corona"],
    renderer: "Corona",
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  await MarketplaceModel.create({
    assetType: "scene",
    source: { provider: "drive", modelId: "home-scene", assetId: "home-scene" },
    title: "Modern living room",
    slug: "home-scene",
    categorySourceId: "living-room",
    styles: ["modern"],
    renderers: ["corona"],
    renderer: "Corona",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });

  const capture = responseCapture();
  await listMarketplaceHomeRecommendations(
    { query: { limit: "6" }, user: { _id: userId } },
    capture.response,
    (error) => { throw error; },
  );
  assert.equal(capture.state.body.engine, "catalog_behavior_v3");
  assert.equal(capture.state.body.mode, "personalized");
  assert.equal(capture.state.body.models[0]._id, preferred._id);
  assert.ok(capture.state.body.models.every((item) => item.assetType === "model"));
  assert.ok(capture.state.body.models.every((item) => item.accessType === "member"));
  assert.ok(capture.state.body.scenes.every((item) => item.assetType === "scene"));
  assert.equal(capture.state.body.models.some((item) => item._id === downloaded._id), false);
});

test("viewed scenes remain eligible for home recommendations until downloaded", async () => {
  await Promise.all([
    MarketplaceModel.deleteMany({}),
    ModelDownload.deleteMany({}),
    MarketplaceInterestProfile.deleteMany({}),
  ]);
  const userId = "cccccccccccccccccccccccc";
  const scenes = await Promise.all(Array.from({ length: 6 }, (_, index) => MarketplaceModel.create({
    assetType: "scene",
    source: { provider: "drive", modelId: `viewed-scene-${index}`, assetId: `viewed-scene-${index}` },
    title: `Viewed scene ${index}`,
    slug: `viewed-scene-${index}`,
    categorySourceId: "living-room",
    styles: ["modern"],
    renderers: ["corona"],
    renderer: "Corona",
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  })));
  await MarketplaceInterestProfile.create({
    actorKey: `user:${userId}`,
    userId,
    weights: { "category:living-room": 6 },
    recentAssetIds: scenes.map((scene) => scene._id),
    eventCount: 6,
    lastEventAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  invalidateMarketplaceHomeRecommendations(userId);

  const capture = responseCapture();
  await listMarketplaceHomeRecommendations(
    { query: { limit: "6" }, user: { _id: userId } },
    capture.response,
    (error) => { throw error; },
  );

  assert.equal(capture.state.statusCode, 200);
  assert.equal(capture.state.body.scenes.length, 6);
  assert.deepEqual(
    new Set(capture.state.body.scenes.map((scene) => scene._id)),
    new Set(scenes.map((scene) => scene._id)),
  );
});

test("home model recommendations rank today's downloads before larger source IDs", async () => {
  await Promise.all([
    MarketplaceModel.deleteMany({}),
    ModelDownload.deleteMany({}),
  ]);
  const createModel = (assetId, title) => MarketplaceModel.create({
    assetType: "model",
    source: { provider: "drive", modelId: assetId, assetId },
    title,
    slug: `home-rank-${assetId}`,
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  const [popularToday, latest, secondLatest] = await Promise.all([
    createModel("100", "Popular today"),
    createModel("900", "Newest model"),
    createModel("800", "Second newest model"),
  ]);
  await ModelDownload.insertMany([
    {
      assetType: "model",
      modelId: popularToday._id,
      userId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      status: "downloaded",
      downloadedAt: new Date(),
    },
    {
      assetType: "model",
      modelId: popularToday._id,
      userId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      status: "downloaded",
      downloadedAt: new Date(),
    },
  ]);
  invalidateMarketplaceHomeRecommendations("bbbbbbbbbbbbbbbbbbbbbbbb");

  const capture = responseCapture();
  await listMarketplaceHomeRecommendations(
    { query: { limit: "3" }, user: { _id: "bbbbbbbbbbbbbbbbbbbbbbbb" } },
    capture.response,
    (error) => { throw error; },
  );

  assert.deepEqual(
    capture.state.body.models.map((model) => model._id),
    [popularToday._id, latest._id, secondLatest._id],
  );
});
