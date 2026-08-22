import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { default: MarketplaceFilterOption } = await import("../src/models/MarketplaceFilterOption.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const {
  adminCreateMarketplaceCategory,
  adminCreateMarketplaceFilterOption,
  adminListMarketplaceTaxonomy,
  adminUpdateMarketplaceCategory,
  adminUpdateMarketplaceFilterOption,
} = await import("../src/controllers/marketplaceTaxonomyAdminController.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { buildMarketplaceTaxonomyBundle } = await import("../src/controllers/marketplaceTaxonomyExportController.js");
const {
  clearMarketplaceTaxonomyCache,
  validateMarketplaceTaxonomy,
} = await import("../src/utils/marketplaceTaxonomy.js");

async function invoke(handler, req) {
  let status = 200;
  let payload;
  await handler(
    req,
    {
      status(code) { status = code; return this; },
      json(value) { payload = value; return value; },
    },
    (error) => { throw error; },
  );
  return { status, payload };
}

test("taxonomy accepts only active Atlas keys and seed preserves edited labels", async () => {
  await initializeMarketplaceCategories();
  const category = await MarketplaceCategory.findOne({ assetType: "model", parentId: { $ne: null } });
  const style = await MarketplaceFilterOption.findOne({ assetType: "model", facet: "style", value: "modern" });
  assert.ok(category);
  assert.ok(style);

  const categoryUpdate = await invoke(adminUpdateMarketplaceCategory, {
    params: { id: category._id },
    body: { title: "Nhãn Việt đã sửa", titleEn: "Edited English label", position: 9, isActive: true },
  });
  const filterUpdate = await invoke(adminUpdateMarketplaceFilterOption, {
    params: { id: style._id },
    body: { labelVi: "Hiện đại tùy chỉnh", labelEn: "Custom modern", isActive: false },
  });
  assert.equal(categoryUpdate.status, 200);
  assert.equal(filterUpdate.status, 200);

  clearMarketplaceTaxonomyCache();
  const invalid = await validateMarketplaceTaxonomy({
    assetType: "model",
    sourceCategoryId: category.sourceCategoryId,
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["wood"],
  });
  assert.ok(invalid.errors.some((error) => error.field === "styles"));

  await initializeMarketplaceCategories();
  assert.equal((await MarketplaceCategory.findById(category._id)).title, "Nhãn Việt đã sửa");
  assert.equal((await MarketplaceFilterOption.findById(style._id)).labelEn, "Custom modern");

  const locked = await invoke(adminUpdateMarketplaceCategory, {
    params: { id: category._id },
    body: { sourceCategoryId: "renamed-key" },
  });
  assert.equal(locked.status, 400);
  assert.match(locked.payload.message, /locked/i);
});

test("admin can create a locked two-level category and taxonomy reports its usage", async () => {
  const root = await invoke(adminCreateMarketplaceCategory, {
    query: {},
    body: { assetType: "model", title: "Nội thất thử nghiệm", titleEn: "Test Interiors", key: "test-interiors", position: 50 },
  });
  assert.equal(root.status, 201);
  assert.equal(root.payload.category.sourceProvider, "internal");

  const child = await invoke(adminCreateMarketplaceCategory, {
    query: {},
    body: { assetType: "model", title: "Ghế thử nghiệm", titleEn: "Test Chairs", key: "test-chairs", parentId: root.payload.category._id },
  });
  assert.equal(child.status, 201);
  assert.equal(String(child.payload.category.parentId), String(root.payload.category._id));

  const duplicate = await invoke(adminCreateMarketplaceCategory, {
    query: {},
    body: { assetType: "model", title: "Trùng", titleEn: "Duplicate", key: "test-chairs" },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.payload.code, "TAXONOMY_KEY_CONFLICT");

  const invalidKey = await invoke(adminCreateMarketplaceCategory, {
    query: {},
    body: { assetType: "model", title: "Key lỗi", titleEn: "Invalid Key", key: "Invalid Key!" },
  });
  assert.equal(invalidKey.status, 400);
  assert.equal(invalidKey.payload.code, "INVALID_TAXONOMY_KEY");

  await MarketplaceModel.create({
    assetType: "model",
    title: "Taxonomy usage model",
    slug: "taxonomy-usage-model",
    categorySourceId: "test-chairs",
    parentCategorySourceId: "test-interiors",
  });
  const listed = await invoke(adminListMarketplaceTaxonomy, { query: { assetType: "model" }, body: {} });
  const listedRoot = listed.payload.categories.find((item) => item.sourceCategoryId === "test-interiors");
  const listedChild = listed.payload.categories.find((item) => item.sourceCategoryId === "test-chairs");
  assert.equal(listedRoot.usageCount, 1);
  assert.equal(listedChild.usageCount, 1);

  const lockedParent = await invoke(adminUpdateMarketplaceCategory, {
    params: { id: child.payload.category._id },
    body: { parentId: "another-parent" },
  });
  assert.equal(lockedParent.status, 400);
});

test("admin can create filter options only inside supported fixed facets", async () => {
  const color = await invoke(adminCreateMarketplaceFilterOption, {
    query: {},
    body: {
      assetType: "model",
      facet: "color",
      labelVi: "Xanh kiểm thử",
      labelEn: "Test Green",
      key: "test-green",
      hex: "#12ab34",
    },
  });
  assert.equal(color.status, 201);
  assert.equal(color.payload.filterOption.hex, "#12ab34");

  const unsupportedSceneFacet = await invoke(adminCreateMarketplaceFilterOption, {
    query: {},
    body: {
      assetType: "scene",
      facet: "material",
      labelVi: "Vải thử nghiệm",
      labelEn: "Test Fabric",
      key: "test-fabric",
    },
  });
  assert.equal(unsupportedSceneFacet.status, 400);
});

test("disabled taxonomy is blocked for new metadata but grandfathered for existing models", async () => {
  const category = await invoke(adminCreateMarketplaceCategory, {
    query: {},
    body: { assetType: "model", title: "Danh mục lưu giữ", titleEn: "Legacy Category", key: "legacy-category" },
  });
  const style = await invoke(adminCreateMarketplaceFilterOption, {
    query: {},
    body: { assetType: "model", facet: "style", labelVi: "Kiểu lưu giữ", labelEn: "Legacy Style", key: "legacy-style" },
  });
  const existingModel = await MarketplaceModel.create({
    assetType: "model",
    title: "Legacy taxonomy model",
    slug: "legacy-taxonomy-model",
    categorySourceId: "legacy-category",
    styles: ["legacy-style"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["wood"],
  });

  await invoke(adminUpdateMarketplaceCategory, {
    params: { id: category.payload.category._id },
    body: { isActive: false },
  });
  await invoke(adminUpdateMarketplaceFilterOption, {
    params: { id: style.payload.filterOption._id },
    body: { isActive: false },
  });
  clearMarketplaceTaxonomyCache();
  const metadata = {
    assetType: "model",
    sourceCategoryId: "legacy-category",
    styles: ["legacy-style"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["wood"],
  };
  const newModelValidation = await validateMarketplaceTaxonomy(metadata);
  const existingModelValidation = await validateMarketplaceTaxonomy(metadata, { currentModel: existingModel });

  assert.ok(newModelValidation.errors.some((item) => item.field === "sourceCategoryId"));
  assert.ok(newModelValidation.errors.some((item) => item.field === "styles"));
  assert.deepEqual(existingModelValidation.errors, []);
});

test("taxonomy export is bilingual, stable and excludes internal identifiers", async () => {
  await initializeMarketplaceCategories();
  const category = await MarketplaceCategory.findOne({ assetType: "model", sourceCategoryId: "98" });
  await invoke(adminUpdateMarketplaceCategory, {
    params: { id: category._id },
    body: { aliasesVi: ["ghế đơn", "  ghế đơn  "], aliasesEn: ["armchair"] },
  });
  clearMarketplaceTaxonomyCache();

  const first = await buildMarketplaceTaxonomyBundle({ assetType: "all" });
  const second = await buildMarketplaceTaxonomyBundle({ assetType: "all" });
  const armchair = first.assets.model.categories.find((item) => item.key === "98");
  const expectedVersion = `sha256:${crypto.createHash("sha256").update(JSON.stringify(first.assets)).digest("hex")}`;
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.taxonomyVersion, expectedVersion);
  assert.equal(first.taxonomyVersion, second.taxonomyVersion);
  assert.deepEqual(armchair.aliasesVi, ["ghế đơn"]);
  assert.equal(armchair.labelEn, "Arm chair");
  assert.ok(armchair.labelVi);
  assert.ok(Object.values(first.assets).every((asset) => asset.categories.every((item) => item.labelVi && item.labelEn)));
  assert.ok(Object.values(first.assets).every((asset) => Object.values(asset.filters).every((items) => (
    items.every((item) => item.labelVi && item.labelEn)
  ))));
  assert.equal(JSON.stringify(first).includes('"_id"'), false);
});

test("Scene seed includes the expanded category tree and style vocabulary", async () => {
  await initializeMarketplaceCategories();
  const firstCategoryCount = await MarketplaceCategory.countDocuments({ assetType: "scene" });
  const firstFilterCount = await MarketplaceFilterOption.countDocuments({ assetType: "scene" });
  await initializeMarketplaceCategories();

  assert.equal(await MarketplaceCategory.countDocuments({ assetType: "scene" }), firstCategoryCount);
  assert.equal(await MarketplaceFilterOption.countDocuments({ assetType: "scene" }), firstFilterCount);

  const categories = await MarketplaceCategory.find({ assetType: "scene" }).lean();
  const categoryKeys = new Set(categories.map((item) => item.sourceCategoryId));
  for (const key of [
    "building", "full-apartment", "restaurant", "coffee-shop", "tea-house", "bakery", "fast-food",
    "reception", "meeting-room", "open-office", "director-room", "co-working-space",
    "gym", "yoga-room", "fitness-center", "sport-hall", "swimming-facility",
    "fashion-store", "furniture-store", "cosmetic-shop", "jewelry-store", "retail-store",
    "furniture-showroom", "car-showroom", "material-showroom", "product-display",
    "massage-room", "facial-room", "waiting-area", "luxury-spa",
    "dental-clinic", "cosmetic-clinic", "examination-room", "reception-area",
    "lounge-bar", "wine-bar", "pub", "rooftop-bar", "cocktail-bar",
  ]) assert.ok(categoryKeys.has(key), `Missing Scene category: ${key}`);

  const styles = await MarketplaceFilterOption.find({ assetType: "scene", facet: "style" }).lean();
  const styleByKey = new Map(styles.map((item) => [item.value, item]));
  for (const key of ["ethnic", "taiwan-style", "scandinavian", "rustic", "color-block", "tropical"]) {
    assert.ok(styleByKey.has(key), `Missing Scene style: ${key}`);
  }
  assert.ok(styleByKey.get("japanese").aliasesEn.includes("Japan Style"));

  clearMarketplaceTaxonomyCache();
  const bundle = await buildMarketplaceTaxonomyBundle({ assetType: "scene" });
  assert.equal(bundle.assets.scene.categories.some((item) => item.key === "full-apartment"), true);
  assert.equal(bundle.assets.scene.filters.style.some((item) => item.value === "taiwan-style"), true);
});
