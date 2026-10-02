import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: Category } = await import("../src/models/MarketplaceCategory.js");
const { default: Filter } = await import("../src/models/MarketplaceFilterOption.js");
const { buildMarketplaceTaxonomyBundle } = await import("../src/controllers/marketplaceTaxonomyExportController.js");
const fixture = JSON.parse(await readFile(new URL("../../docs/contracts/plugin-taxonomy-v1.json", import.meta.url), "utf8"));

test("taxonomy exporter retains the shared Desktop parser contract", async () => {
  const expected = fixture.assets.model;
  for (const row of expected.categories) {
    await Category.create({
      assetType: "model", sourceCategoryId: row.key, parentSourceCategoryId: row.parentKey,
      title: row.labelVi, titleEn: row.labelEn, aliasesVi: row.aliasesVi, aliasesEn: row.aliasesEn,
      position: row.position, slug: `contract-${row.key}`, isActive: true,
    });
  }
  for (const row of expected.filters.render) {
    await Filter.create({ ...row, assetType: "model", isActive: true });
  }
  const actual = await buildMarketplaceTaxonomyBundle({ assetType: "model" });
  assert.equal(actual.schemaVersion, fixture.schemaVersion);
  assert.deepEqual(actual.assets.model.categories, expected.categories);
  assert.deepEqual(actual.assets.model.filters.render, expected.filters.render);
  assert.equal(JSON.stringify(actual).includes('"_id"'), false);
});
