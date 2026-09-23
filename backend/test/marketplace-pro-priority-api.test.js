import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");

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

function catalogAsset(index, accessType = "member", assetType = "model", title = "") {
  const resolvedTitle = title || `${accessType === "free" ? "Free" : "Pro"} ${assetType} ${index}`;
  return {
    assetType,
    source: {
      provider: "drive",
      modelId: `${assetType}-${accessType}-${index}`,
      assetId: `${assetType}-${accessType}-${index}`,
    },
    sourceAssetIdSort: index,
    title: resolvedTitle,
    titleSort: resolvedTitle.toLowerCase(),
    slug: resolvedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    accessType,
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    downloadCount: 100 - index,
  };
}

async function list(query = {}, assetType = "model") {
  const capture = responseCapture();
  await listMarketplaceModels(
    { query, marketplaceAssetType: assetType },
    capture.response,
    (error) => { throw error; },
  );
  assert.equal(capture.state.statusCode, 200);
  return capture.state.body;
}

test("popular Model pages rank Free and Pro together before pagination", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(1, "member"),
    catalogAsset(2, "free"),
    catalogAsset(3, "member"),
    catalogAsset(4, "free"),
  ]);

  const first = await list({ page: "1", limit: "2", sort: "popular" });
  const second = await list({ page: "2", limit: "2", sort: "popular" });

  assert.deepEqual([...first.models, ...second.models].map((item) => item.accessType), [
    "member", "free", "member", "free",
  ]);
  assert.equal(first.ranking.policy, "model_mixed_access_v4");
  assert.equal(first.ranking.proFirst, false);
  assert.equal(first.ranking.bypassed, false);
  assert.equal(first.pagination.total, 4);
  assert.equal(
    new Set([...first.models, ...second.models].map((item) => item._id)).size,
    first.models.length + second.models.length,
  );
});

test("newest Model pages mix Free and Pro by descending source ID", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(10, "member"),
    catalogAsset(20, "free"),
    catalogAsset(30, "member"),
    catalogAsset(40, "free"),
  ]);

  const first = await list({ page: "1", limit: "2", sort: "newest" });
  const second = await list({ page: "2", limit: "2", sort: "newest" });

  assert.deepEqual([...first.models, ...second.models].map((item) => item.title), [
    "Free model 40",
    "Pro model 30",
    "Free model 20",
    "Pro model 10",
  ]);
  assert.equal(first.ranking.proFirst, false);
  assert.equal(first.ranking.bypassed, false);
  assert.equal(first.pagination.total, 4);
});

test("explicit Free and Pro filters bypass the access mix", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    ...Array.from({ length: 12 }, (_, index) => catalogAsset(index, "member")),
    ...Array.from({ length: 5 }, (_, index) => catalogAsset(index, "free")),
  ]);

  const free = await list({ accessType: "free", limit: "60" });
  const pro = await list({ accessType: "member", limit: "60" });

  assert.equal(free.models.length, 5);
  assert.ok(free.models.every((item) => item.accessType === "free"));
  assert.equal(free.ranking.bypassed, true);
  assert.equal(free.ranking.reason, "access_filter");
  assert.equal(pro.models.length, 12);
  assert.ok(pro.models.every((item) => item.accessType === "member"));
});

test("an exact Free title can rank ahead of less relevant Pro models", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(1, "free", "model", "Ghe banh"),
    catalogAsset(2, "member", "model", "Ghe banh hien dai"),
    catalogAsset(3, "member", "model", "Bo ghe banh co dien"),
  ]);

  const result = await list({ q: "ghế bành", sort: "relevance", limit: "10" });

  assert.equal(result.models.length, 3);
  assert.deepEqual(result.models.map((item) => item.accessType), ["free", "member", "member"]);
  assert.equal(result.models[0].title, "Ghe banh");
  assert.equal(result.search.engine, "mongo_hybrid_v3");
});

test("Scene discovery remains unchanged", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany(
    Array.from({ length: 12 }, (_, index) => catalogAsset(index, "free", "scene")),
  );

  const result = await list({ limit: "10", sort: "popular" }, "scene");

  assert.equal(result.scenes.length, 10);
  assert.ok(result.scenes.every((item) => item.accessType === "free"));
  assert.equal(result.ranking.bypassed, true);
  assert.equal(result.ranking.reason, "asset_type");
});
