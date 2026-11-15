import test from "node:test";
import assert from "node:assert/strict";

const previousEnvironment = {
  engine: process.env.MARKETPLACE_SEARCH_ENGINE,
  url: process.env.MEILISEARCH_URL,
  key: process.env.MEILI_MASTER_KEY,
  semantic: process.env.MARKETPLACE_SEARCH_SEMANTIC_ENABLED,
  rollout: process.env.MARKETPLACE_MEILI_ROLLOUT_PERCENT,
  shadow: process.env.MARKETPLACE_MEILI_SHADOW_ENABLED,
};

process.env.MARKETPLACE_SEARCH_ENGINE = "meilisearch";
process.env.MEILISEARCH_URL = "http://meilisearch.test:7700";
process.env.MEILI_MASTER_KEY = "test-master-key-with-more-than-16-characters";
process.env.MARKETPLACE_SEARCH_SEMANTIC_ENABLED = "true";

const {
  buildMarketplaceMeiliDocument,
  marketplaceMeiliTrafficDecision,
  searchMarketplaceMeili,
} = await import("../src/utils/marketplaceMeilisearch.js");

function hit(id, accessType, score = 0.9) {
  return {
    _rankingScore: score,
    card: {
      _id: id,
      assetType: "model",
      title: id,
      slug: id,
      accessType,
    },
  };
}

function mockRankedSearch(t, ranked) {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    bodies.push(body);
    const filter = body.filter.join(" ");
    const access = ["free", "member"].find(value => filter.includes(`accessType = "${value}"`));
    const matching = access ? ranked.filter(item => item.card.accessType === access) : ranked;
    return new Response(JSON.stringify({
      estimatedTotalHits: matching.length,
      processingTimeMs: 4,
      hits: matching.slice(body.offset, body.offset + body.limit),
    }), { status: 200 });
  });
  return bodies;
}

test("Meilisearch keeps combined relevance across pages, ignoring the legacy Pro boost", async t => {
  const ranked = Array.from({ length: 85 }, (_, index) => hit(`asset-${index}`, index % 4 ? "member" : "free", 1 - index / 100));
  const bodies = mockRankedSearch(t, ranked);
  const options = { assetType: "model", q: "ghe bamh", limit: 60, prioritizePro: true, facets: {}, sort: "relevance" };
  const first = await searchMarketplaceMeili({ ...options, page: 1 });
  const second = await searchMarketplaceMeili({ ...options, page: 2 });
  assert.equal(first.total, 85);
  assert.equal(first.assets[0].accessType, "free");
  assert.equal(second.assets.length, 25);
  assert.deepEqual([...first.assets, ...second.assets].map(item => item._id), ranked.map(item => item.card._id));
  assert.equal(bodies.length, 2, "Each normal page uses one combined search request");
  assert.ok(bodies.every(body => !body.filter.some(filter => filter.startsWith("accessType ="))));
  assert.ok(bodies.every(body => body.hybrid?.semanticRatio === 0.15));
});

test("Meilisearch keeps explicit access filters and a shared last-page offset", async t => {
  const ranked = [hit("free-exact", "free"), hit("pro-related", "member"), hit("free-other", "free")];
  const bodies = mockRankedSearch(t, ranked);
  for (const accessType of ["free", "member"]) {
    const result = await searchMarketplaceMeili({ assetType: "model", q: "chair", accessType, limit: 60 });
    assert.ok(result.assets.every(item => item.accessType === accessType));
    assert.ok(bodies.at(-1).filter.includes(`accessType = "${accessType}"`));
  }
  const last = await searchMarketplaceMeili({ assetType: "model", q: "chair", page: 999, limit: 2 });
  assert.equal(last.safePage, 2);
  assert.equal(last.total, 3);
  assert.deepEqual(last.assets.map(item => item._id), ["free-other"]);
  assert.equal(bodies.at(-1).offset, 2);
});

test("Meilisearch semantic retry searches the combined catalog without access bias", async t => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    const hits = body.hybrid?.semanticRatio === 0.65 ? [hit("free-match", "free"), hit("pro-match", "member")] : [];
    return Response.json({ estimatedTotalHits: hits.length, hits });
  });
  const result = await searchMarketplaceMeili({ assetType: "model", q: "sculptural vintage chair", limit: 10 });
  assert.equal(result.mode, "semantic_retry");
  assert.deepEqual(result.assets.map(item => item.accessType), ["free", "member"]);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every(body => !body.filter.some(filter => filter.startsWith("accessType ="))));
});

test("Meilisearch rollout bucket is stable and shadow only applies outside rollout", () => {
  process.env.MARKETPLACE_MEILI_ROLLOUT_PERCENT = "0";
  process.env.MARKETPLACE_MEILI_SHADOW_ENABLED = "true";
  const first = marketplaceMeiliTrafficDecision("user:stable-id");
  const second = marketplaceMeiliTrafficDecision("user:stable-id");
  assert.equal(first.bucket, second.bucket);
  assert.equal(first.useMeili, false);
  assert.equal(first.shadow, true);

  process.env.MARKETPLACE_MEILI_ROLLOUT_PERCENT = "100";
  const enabled = marketplaceMeiliTrafficDecision("user:stable-id");
  assert.equal(enabled.useMeili, true);
  assert.equal(enabled.shadow, false);
});

test("Meilisearch cards expose the first preview that is distinct from the cover", async () => {
  const context = { categories: [], categoryByKey: new Map(), filterByFacet: {} };
  const document = await buildMarketplaceMeiliDocument({
    _id: "asset-with-preview",
    assetType: "scene",
    title: "Scene with preview",
    slug: "scene-with-preview",
    coverImage: { driveFileId: "cover-id", fileName: "cover.jpg" },
    previewImages: [
      { driveFileId: "cover-id", fileName: "cover.jpg" },
      { driveFileId: "preview-id-1", fileName: "preview-01.jpg", width: 1200, height: 1200 },
      { driveFileId: "preview-id-2", fileName: "preview-02.jpg", width: 1600, height: 900 },
    ],
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
  }, {}, context);

  assert.equal(document.card.previewImages.length, 1);
  assert.match(document.card.previewImages[0].url, /\/api\/marketplace\/scenes\/asset-with-preview\/preview\/1\?v=/);
  assert.equal(document.card.previewImages[0].width, 1200);
  assert.notEqual(document.card.previewImages[0].url, document.card.coverImage.url);

  const singlePreviewDocument = await buildMarketplaceMeiliDocument({
    _id: "asset-with-one-preview",
    assetType: "model",
    title: "Model with one preview",
    slug: "model-with-one-preview",
    coverImage: { driveFileId: "single-cover-id", fileName: "cover.jpg" },
    previewImages: [
      { driveFileId: "single-preview-id", fileName: "preview-01.jpg", width: 900, height: 900 },
    ],
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
  }, {}, context);

  assert.match(singlePreviewDocument.card.previewImages[0].url, /\/api\/marketplace\/models\/asset-with-one-preview\/preview\/0\?v=/);
});

test("Meilisearch retries lexical search when hybrid search is temporarily unavailable", async () => {
  const previousFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    bodies.push(body);
    if (body.hybrid) throw new Error("Semantic embedder is still indexing");
    return new Response(JSON.stringify({
      estimatedTotalHits: 1,
      processingTimeMs: 3,
      hits: [hit("lexical-result", "member")],
    }), { status: 200 });
  };

  try {
    const result = await searchMarketplaceMeili({
      assetType: "model",
      accessType: "member",
      q: "arched door",
      page: 1,
      limit: 60,
      facets: {},
      sort: "relevance",
    });
    assert.equal(result.total, 1);
    assert.equal(result.assets[0].slug, "lexical-result");
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].hybrid);
    assert.equal(bodies[1].hybrid, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test.after(() => {
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("MARKETPLACE_SEARCH_ENGINE", previousEnvironment.engine);
  restore("MEILISEARCH_URL", previousEnvironment.url);
  restore("MEILI_MASTER_KEY", previousEnvironment.key);
  restore("MARKETPLACE_SEARCH_SEMANTIC_ENABLED", previousEnvironment.semantic);
  restore("MARKETPLACE_MEILI_ROLLOUT_PERCENT", previousEnvironment.rollout);
  restore("MARKETPLACE_MEILI_SHADOW_ENABLED", previousEnvironment.shadow);
});
