import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { default: MarketplaceInterestProfile } = await import("../src/models/MarketplaceInterestProfile.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");
const { marketplaceSourceIdNumber, normalizeMarketplaceTitle } = await import("../src/utils/marketplaceSort.js");
const { marketplaceActorKey } = await import("../src/utils/marketplaceBehaviorService.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { clearMarketplaceTaxonomyCache } = await import("../src/utils/marketplaceTaxonomy.js");

async function createCatalogAsset({
  title,
  slug,
  createdAt,
  downloadCount,
  assetId = slug,
  categorySourceId = "",
  parentCategorySourceId = "",
}) {
  const model = await MarketplaceModel.create({
    assetType: "model",
    source: {
      provider: "sort-test",
      modelId: slug,
      assetId,
    },
    sourceAssetIdSort: marketplaceSourceIdNumber(assetId),
    title,
    titleSort: normalizeMarketplaceTitle(title),
    slug,
    categorySourceId,
    parentCategorySourceId,
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["white"],
    materials: ["wood"],
    renderer: "Corona",
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    downloadCount,
  });
  await MarketplaceModel.findByIdAndUpdate(model._id, { $set: { createdAt } });
  return model;
}

async function list(query = {}, request = {}) {
  let payload;
  await listMarketplaceModels(
    {
      query,
      user: request.user,
      body: {},
      ip: "127.0.0.1",
      get(name) {
        return request.headers?.[String(name).toLowerCase()] || "";
      },
    },
    {
      json(value) {
        payload = value;
        return value;
      },
    },
    (error) => {
      throw error;
    },
  );
  return payload;
}

await createCatalogAsset({
  title: "Gamma Chair",
  slug: "sort-gamma",
  createdAt: "2026-01-03T00:00:00.000Z",
  downloadCount: 20,
});
await createCatalogAsset({
  title: "Álpha Chair",
  slug: "sort-alpha",
  createdAt: "2026-01-01T00:00:00.000Z",
  downloadCount: 5,
});
await createCatalogAsset({
  title: "Delta Chair",
  slug: "sort-delta",
  createdAt: "2026-01-04T00:00:00.000Z",
  downloadCount: 10,
});
await createCatalogAsset({
  title: "Beta Chair",
  slug: "sort-beta",
  createdAt: "2026-01-02T00:00:00.000Z",
  downloadCount: 80,
});

test("marketplace title normalization is accent-insensitive", () => {
  assert.equal(normalizeMarketplaceTitle("  Đèn Ánh Sáng  "), "den anh sang");
});

test("marketplace list defaults to newest and reports the effective sort", async () => {
  const payload = await list({ limit: "4" });
  assert.deepEqual(payload.models.map((item) => item.title), [
    "Delta Chair",
    "Gamma Chair",
    "Beta Chair",
    "Álpha Chair",
  ]);
  assert.deepEqual(payload.sort, { requested: null, effective: "newest" });
});

test("popular ordering is applied before pagination", async () => {
  const popular = await list({ sort: "popular", limit: "2", page: "1" });
  assert.deepEqual(popular.models.map((item) => item.title), ["Beta Chair", "Gamma Chair"]);
  assert.equal(popular.sort.effective, "popular");
});

test("removed and legacy sort names safely resolve to newest", async () => {
  for (const legacySort of ["source_id_desc", "oldest", "title_asc", "title_desc"]) {
    const payload = await list({ sort: legacySort, limit: "4" });
    assert.deepEqual(payload.sort, { requested: "newest", effective: "newest" });
  }
});

test("text search defaults to relevance while invalid sort falls back safely", async () => {
  const search = await list({ q: "Gamma", limit: "4" });
  assert.equal(search.sort.effective, "relevance");
  assert.deepEqual(search.models.map((item) => item.title), ["Gamma Chair"]);

  const invalid = await list({ sort: "not-a-sort", limit: "4" });
  assert.deepEqual(invalid.sort, { requested: null, effective: "newest" });
});

test("no-match typo searches return an empty result instead of throwing", async () => {
  for (const query of ["receiption", "adoor", "ardoor", "arcdoor", "archeddoor", "archedoor"]) {
    const payload = await list({ q: query, sort: "featured", limit: "60" });

    assert.deepEqual(payload.models, []);
    assert.equal(payload.pagination.total, 0);
  }
});

test("route-level Mongo timeouts return a safe empty search response", async () => {
  const gamma = await MarketplaceModel.findOne({ slug: "sort-gamma" });
  await MarketplaceModel.findByIdAndUpdate(gamma._id, { $set: { categorySourceId: "timeout-category" } });
  clearMarketplaceTaxonomyCache();
  const originalFind = MarketplaceCategory.find;
  MarketplaceCategory.find = () => {
    const error = new Error("error while multiplanner was selecting best plan :: caused by :: operation exceeded time limit");
    error.code = 50;
    error.codeName = "MaxTimeMSExpired";
    throw error;
  };

  try {
    const payload = await list({ q: "Gamma", sort: "relevance", limit: "60" });
    assert.deepEqual(payload.models, []);
    assert.equal(payload.pagination.total, 0);
    assert.equal(payload.search.engine, "mongo_timeout_fallback");
  } finally {
    MarketplaceCategory.find = originalFind;
    clearMarketplaceTaxonomyCache();
    await MarketplaceModel.findByIdAndUpdate(gamma._id, { $set: { categorySourceId: "" } });
  }
});

test("external URLs are rejected before they can reach catalog search", async () => {
  const payload = await list({
    q: "https://3d.3d66.com/reshtmla/model/items/rz/example.html?action_id=long-query",
    accessType: "pro",
    sort: "relevance",
  });

  assert.deepEqual(payload.models, []);
  assert.equal(payload.pagination.total, 0);
  assert.equal(payload.search.engine, "input_guard_v1");
  assert.equal(payload.search.mode, "external_url");
});

test("a public 3DIPL detail URL is normalized back to its catalog slug", async () => {
  const payload = await list({ q: "https://3dipl.org/models/sort-gamma", limit: "4" });

  assert.deepEqual(payload.models.map((item) => item.title), ["Gamma Chair"]);
  assert.equal(payload.sort.effective, "relevance");
});

test("newest means numeric source ID descending before pagination", async () => {
  await createCatalogAsset({
    title: "ID Nine",
    slug: "source-id-nine",
    assetId: "9",
    createdAt: "2025-01-01T00:00:00.000Z",
    downloadCount: 0,
  });
  await createCatalogAsset({
    title: "ID One Hundred",
    slug: "source-id-hundred",
    assetId: "100",
    createdAt: "2025-01-01T00:00:00.000Z",
    downloadCount: 0,
  });
  await createCatalogAsset({
    title: "ID One Thousand",
    slug: "source-id-thousand",
    assetId: "1000",
    createdAt: "2025-01-01T00:00:00.000Z",
    downloadCount: 0,
  });

  const payload = await list({ sort: "newest", limit: "3" });
  assert.deepEqual(payload.models.map((item) => item.title), [
    "ID One Thousand",
    "ID One Hundred",
    "ID Nine",
  ]);
  assert.equal(payload.sort.effective, "newest");
});

test("featured models use the visitor interest profile", async () => {
  const preferred = await createCatalogAsset({
    title: "Personalized Quiet Chair",
    slug: "personalized-quiet-chair",
    assetId: "7001",
    categorySourceId: "personalized-chair",
    createdAt: "2026-01-06T00:00:00.000Z",
    downloadCount: 0,
  });
  await createCatalogAsset({
    title: "Generic Popular Cabinet",
    slug: "generic-popular-cabinet",
    assetId: "9000",
    categorySourceId: "generic-cabinet",
    createdAt: "2026-01-07T00:00:00.000Z",
    downloadCount: 10_000,
  });
  const sessionId = "marketplace-featured-sort-session-12345";
  const actorKey = marketplaceActorKey({ sessionId });
  await MarketplaceInterestProfile.create({
    actorKey,
    weights: { "category:personalized-chair": 50 },
    recentAssetIds: [preferred._id],
    eventCount: 5,
    lastEventAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  const payload = await list(
    { sort: "featured", limit: "4" },
    { headers: { "x-marketplace-session-id": sessionId } },
  );
  assert.equal(payload.models[0].slug, "personalized-quiet-chair");
  assert.equal(payload.sort.effective, "featured");
  assert.equal(payload.sort.mode, "personalized");
});

test("taxonomy search accepts Vietnamese, unaccented Vietnamese and English", async () => {
  await initializeMarketplaceCategories();
  await createCatalogAsset({
    title: "Bespoke Seat X",
    slug: "bilingual-armchair",
    createdAt: "2026-01-05T00:00:00.000Z",
    downloadCount: 1,
  });
  const created = await MarketplaceModel.findOne({ slug: "bilingual-armchair" });
  await MarketplaceModel.findByIdAndUpdate(created._id, {
    $set: { categorySourceId: "98", parentCategorySourceId: "2", searchStatus: "pending" },
  });

  const vietnamese = await list({ q: "ghế bành", limit: "10" });
  const unaccented = await list({ q: "ghe banh", limit: "10" });
  const english = await list({ q: "arm chair", limit: "10" });
  const reversed = await list({ q: "chair arm", limit: "10" });
  const vietnameseTypo = await list({ q: "ghe banhh", limit: "10" });
  const englishTypo = await list({ q: "arm chiar", limit: "10" });
  for (const payload of [vietnamese, unaccented, english, reversed, vietnameseTypo, englishTypo]) {
    assert.equal(payload.search.engine, "mongo_hybrid_v3");
    assert.ok(payload.models.some((item) => item.slug === "bilingual-armchair"));
  }
  assert.equal(vietnameseTypo.search.mode, "fuzzy");
  assert.equal(englishTypo.search.mode, "fuzzy");
});
