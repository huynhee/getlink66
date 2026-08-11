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

test("unfiltered Model pages return Pro first and Free afterward", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    ...Array.from({ length: 18 }, (_, index) => catalogAsset(index, "member")),
    ...Array.from({ length: 4 }, (_, index) => catalogAsset(index, "free")),
  ]);

  const first = await list({ page: "1", limit: "10", sort: "popular" });
  const second = await list({ page: "2", limit: "10", sort: "popular" });
  const third = await list({ page: "3", limit: "10", sort: "popular" });

  assert.ok(first.models.every((item) => item.accessType === "member"));
  assert.deepEqual(second.models.map((item) => item.accessType), [
    ...Array(8).fill("member"),
    ...Array(2).fill("free"),
  ]);
  assert.ok(third.models.every((item) => item.accessType === "free"));
  assert.equal(first.ranking.policy, "model_pro_first_v3");
  assert.equal(first.ranking.proFirst, true);
  assert.equal(first.ranking.bypassed, false);
  assert.equal(first.pagination.total, 22);
  assert.equal(
    new Set([...first.models, ...second.models, ...third.models].map((item) => item._id)).size,
    first.models.length + second.models.length + third.models.length,
  );
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

test("an exact Free title remains in results after matching Pro models", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(1, "free", "model", "Ghe banh"),
    catalogAsset(2, "member", "model", "Ghe banh hien dai"),
    catalogAsset(3, "member", "model", "Bo ghe banh co dien"),
  ]);

  const result = await list({ q: "ghế bành", sort: "relevance", limit: "10" });

  assert.equal(result.models.length, 3);
  assert.deepEqual(result.models.map((item) => item.accessType), ["member", "member", "free"]);
  assert.equal(result.models.at(-1).title, "Ghe banh");
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
