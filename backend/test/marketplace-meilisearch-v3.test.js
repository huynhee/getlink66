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

test("Meilisearch model results keep the complete Pro set before Free", async () => {
  const previousFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    bodies.push(body);
    const filter = Array.isArray(body.filter) ? body.filter.join(" ") : String(body.filter || "");
    const isMember = filter.includes('accessType = "member"');
    if (body.limit === 0) {
      return new Response(JSON.stringify({ estimatedTotalHits: isMember ? 65 : 20, hits: [] }), { status: 200 });
    }
    const prefix = isMember ? "pro" : "free";
    const accessType = isMember ? "member" : "free";
    return new Response(JSON.stringify({
      estimatedTotalHits: isMember ? 65 : 20,
      processingTimeMs: 4,
      hits: Array.from({ length: body.limit }, (_, index) => hit(`${prefix}-${body.offset + index}`, accessType)),
    }), { status: 200 });
  };

  try {
    const result = await searchMarketplaceMeili({
      assetType: "model",
      q: "ghe bamh",
      page: 2,
      limit: 60,
      prioritizePro: true,
      facets: {},
      sort: "relevance",
    });
    assert.equal(result.total, 85);
    assert.equal(result.assets.length, 25);
    assert.deepEqual(result.assets.slice(0, 5).map((item) => item.accessType), Array(5).fill("member"));
    assert.deepEqual(result.assets.slice(5).map((item) => item.accessType), Array(20).fill("free"));
    assert.ok(bodies.every((body) => body.hybrid?.semanticRatio === 0.15));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Meilisearch newest models use one mixed source ID ordering", async () => {
  const previousFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    bodies.push(body);
    return new Response(JSON.stringify({
      estimatedTotalHits: 3,
      hits: [hit("free-300", "free"), hit("pro-200", "member"), hit("free-100", "free")],
    }), { status: 200 });
  };

  try {
    const result = await searchMarketplaceMeili({
      assetType: "model",
      q: "",
      page: 1,
      limit: 3,
      prioritizePro: false,
      facets: {},
      sort: "newest",
    });
    assert.deepEqual(result.assets.map((item) => item._id), ["free-300", "pro-200", "free-100"]);
    assert.equal(bodies.length, 1);
    assert.ok(bodies[0].filter.every((filter) => !filter.includes("accessType")));
    assert.deepEqual(bodies[0].sort, ["sourceAssetIdSort:desc", "createdAtEpoch:desc"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
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
