import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");
const { marketplaceSourceIdNumber, normalizeMarketplaceTitle } = await import("../src/utils/marketplaceSort.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");

async function createCatalogAsset({ title, slug, createdAt, downloadCount, assetId = slug }) {
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
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["white"],
    materials: ["wood"],
    renderer: "Corona",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    downloadCount,
  });
  await MarketplaceModel.findByIdAndUpdate(model._id, { $set: { createdAt } });
  return model;
}

async function list(query = {}) {
  let payload;
  await listMarketplaceModels(
    { query },
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

test("popular and oldest ordering are applied before pagination", async () => {
  const popular = await list({ sort: "popular", limit: "2", page: "1" });
  assert.deepEqual(popular.models.map((item) => item.title), ["Beta Chair", "Gamma Chair"]);
  assert.equal(popular.sort.effective, "popular");

  const oldestPageTwo = await list({ sort: "oldest", limit: "2", page: "2" });
  assert.deepEqual(oldestPageTwo.models.map((item) => item.title), ["Gamma Chair", "Delta Chair"]);
  assert.equal(oldestPageTwo.pagination.page, 2);
});

test("title ordering uses normalized titles and remains stable across pages", async () => {
  const ascendingFirst = await list({ sort: "title_asc", limit: "2", page: "1" });
  const ascendingSecond = await list({ sort: "title_asc", limit: "2", page: "2" });
  assert.deepEqual(ascendingFirst.models.map((item) => item.title), ["Álpha Chair", "Beta Chair"]);
  assert.deepEqual(ascendingSecond.models.map((item) => item.title), ["Delta Chair", "Gamma Chair"]);

  const descending = await list({ sort: "title_desc", limit: "4" });
  assert.deepEqual(descending.models.map((item) => item.title), [
    "Gamma Chair",
    "Delta Chair",
    "Beta Chair",
    "Álpha Chair",
  ]);
});

test("text search defaults to relevance while invalid sort falls back safely", async () => {
  const search = await list({ q: "Gamma", limit: "4" });
  assert.equal(search.sort.effective, "relevance");
  assert.deepEqual(search.models.map((item) => item.title), ["Gamma Chair"]);

  const invalid = await list({ sort: "not-a-sort", limit: "4" });
  assert.deepEqual(invalid.sort, { requested: null, effective: "newest" });
});

test("source ID ordering is numeric and applied before pagination", async () => {
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

  const payload = await list({ sort: "source_id_desc", limit: "3" });
  assert.deepEqual(payload.models.map((item) => item.title), [
    "ID One Thousand",
    "ID One Hundred",
    "ID Nine",
  ]);
  assert.equal(payload.sort.effective, "source_id_desc");
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
