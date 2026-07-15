import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { default: MarketplaceFilterOption } = await import("../src/models/MarketplaceFilterOption.js");
const {
  adminUpdateMarketplaceCategory,
  adminUpdateMarketplaceFilterOption,
} = await import("../src/controllers/marketplaceTaxonomyAdminController.js");
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
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
