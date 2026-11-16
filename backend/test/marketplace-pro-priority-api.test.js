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
    sourceAssetIdSort: index,
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

test("Model browsing keeps all Pro before Free without duplicate or missing pagination", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    ...Array.from({ length: 18 }, (_, index) => catalogAsset(index, "member")),
    ...Array.from({ length: 4 }, (_, index) => catalogAsset(index, "free")),
  ]);

  const first = await list({ page: "1", limit: "10", sort: "popular" });
  const second = await list({ page: "2", limit: "10", sort: "popular" });
  const third = await list({ page: "3", limit: "10", sort: "popular" });

  assert.ok(first.models.some((item) => item.accessType === "member"));
  assert.ok(first.models.every((item) => item.accessType === "member"));
  const all = [...first.models, ...second.models, ...third.models];
  assert.deepEqual(all.map((item) => item.accessType), [...Array(18).fill("member"), ...Array(4).fill("free")]);
  assert.deepEqual(all.map((item) => item.downloadCount), [
    ...Array.from({ length: 18 }, (_, index) => 100 - index), 100, 99, 98, 97,
  ]);
  assert.equal(first.ranking.policy, "model_browse_pro_first_v3");
  assert.equal(first.ranking.proFirst, true);
  assert.equal(first.ranking.bypassed, false);
  assert.equal(first.pagination.total, 22);
  assert.equal(
    new Set([...first.models, ...second.models, ...third.models].map((item) => item._id)).size,
    first.models.length + second.models.length + third.models.length,
  );
});

test("explicit Free and Pro filters restrict the combined catalog", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    ...Array.from({ length: 12 }, (_, index) => catalogAsset(index, "member")),
    ...Array.from({ length: 5 }, (_, index) => catalogAsset(index, "free")),
  ]);

  const free = await list({ accessType: "free", limit: "60" });
  const pro = await list({ accessType: "member", limit: "60" });
  const proAlias = await list({ accessType: "pro", limit: "60" });

  assert.equal(free.models.length, 5);
  assert.ok(free.models.every((item) => item.accessType === "free"));
  assert.equal(free.ranking.bypassed, true);
  assert.equal(free.ranking.reason, "access_filter");
  assert.equal(pro.models.length, 12);
  assert.ok(pro.models.every((item) => item.accessType === "member"));
  assert.deepEqual(proAlias.models.map(item => item._id), pro.models.map(item => item._id));
});

test("newest browsing prioritizes Pro, while newest search mixes matching access types", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(10, "free"), catalogAsset(20, "member"), catalogAsset(30, "free"),
  ]);
  const result = await list({ sort: "newest", limit: "10" });
  assert.deepEqual(result.models.map(item => item.title), ["Pro model 20", "Free model 30", "Free model 10"]);
  assert.deepEqual(result.models.map(item => item.accessType), ["member", "free", "free"]);
  const searched = await list({ q: "model", sort: "newest", limit: "10" });
  assert.deepEqual(searched.models.map(item => item.title), ["Free model 30", "Pro model 20", "Free model 10"]);
  assert.equal(searched.ranking.proFirst, false);
});

test("clearing a query restores browse priority and whitespace is not a search", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(1, "free", "model", "Ghe banh"),
    catalogAsset(2, "member", "model", "Ghe banh hien dai"),
  ]);
  assert.equal((await list({ q: "ghe banh" })).models[0].accessType, "free");
  for (const q of ["", "  "]) {
    const result = await list({ q });
    assert.equal(result.ranking.proFirst, true);
    assert.equal(result.models[0].accessType, "member");
  }
  assert.equal((await list({ q: "ghe banh" })).models[0].accessType, "free");
});

test("featured browsing keeps Pro before Free across recommended and remaining pages", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    ...Array.from({ length: 18 }, (_, index) => catalogAsset(index, "member")),
    ...Array.from({ length: 4 }, (_, index) => ({ ...catalogAsset(index, "free"), downloadCount: 1000 - index })),
  ]);
  const pages = [];
  for (let page = 1; page <= 3; page++) pages.push(await list({ sort: "featured", page: String(page), limit: "10" }));
  const all = pages.flatMap(result => result.models);
  assert.deepEqual(all.map(item => item.accessType), [...Array(18).fill("member"), ...Array(4).fill("free")]);
  assert.equal(new Set(all.map(item => item._id)).size, 22);
  assert.equal(pages[0].ranking.proFirst, true);
});

test("an exact Free title ranks ahead of less relevant Pro titles", async () => {
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
  assert.equal(result.ranking.reason, "access_neutral");
});

test("a Meilisearch outage retains access-neutral relevance in the Mongo fallback", async t => {
  const settings = {
    MARKETPLACE_SEARCH_ENGINE: "meilisearch", MEILISEARCH_URL: "http://meilisearch.test:7700",
    MEILI_MASTER_KEY: "ranking-fixture-only", MARKETPLACE_MEILI_ROLLOUT_PERCENT: "100",
    MARKETPLACE_SEARCH_SEMANTIC_ENABLED: "false",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; throw new Error("Fixture search unavailable"); });
  await MarketplaceModel.deleteMany({});
  await MarketplaceModel.insertMany([
    catalogAsset(1, "free", "model", "Ghe banh"),
    catalogAsset(2, "member", "model", "Ghe banh hien dai"),
  ]);
  const result = await list({ q: "ghe banh", limit: "10" });
  assert.equal(attempts, 1);
  assert.equal(result.search.engine, "mongo_hybrid_v3");
  assert.deepEqual(result.models.map(item => item.accessType), ["free", "member"]);
  assert.equal(result.ranking.proFirst, false);
  const browsing = await list({ limit: "10" });
  assert.deepEqual(browsing.models.map(item => item.accessType), ["member", "free"]);
  assert.equal(browsing.ranking.proFirst, true);
});
