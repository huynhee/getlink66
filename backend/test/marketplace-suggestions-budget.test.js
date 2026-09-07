import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { optionalSearchWithin } from "../src/utils/searchDeadline.js";

useMemoryDb();
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { listMarketplaceSearchSuggestions } = await import("../src/controllers/marketplaceController.js");

test("an optional autocomplete query cannot hold the response indefinitely", async () => {
  const result = await optionalSearchWithin(new Promise(() => {}), 20, []);
  assert.deepEqual(result, []);
  assert.equal(await optionalSearchWithin(Promise.reject(new Error("Mongo timeout")), 20), null);
});

test("Mongo suggestions normalize tokens, escape regex, and never return unpublished assets", async () => {
  const oldEngine = process.env.MARKETPLACE_SEARCH_ENGINE;
  process.env.MARKETPLACE_SEARCH_ENGINE = "mongo";
  try {
    for (const published of [true, false]) {
      await MarketplaceModel.create({
        assetType: "scene", title: published ? "Office Desk" : "Private Office Desk",
        slug: published ? "office-desk" : "private-office-desk", isPublished: published,
        metadataStatus: "complete", fileStatus: "ready", searchTokens: ["office", "desk"],
      });
    }
    let body;
    const res = { json: (data) => { body = data; return data; } };
    const next = (error) => { throw error; };
    await listMarketplaceSearchSuggestions({ query: { assetType: "scene", q: "OFFICE de", limit: "invalid" } }, res, next);
    assert.equal(body.engine, "mongo_prefix_fallback");
    assert.deepEqual(body.suggestions.map((item) => item.slug), ["office-desk"]);
    await listMarketplaceSearchSuggestions({ query: { assetType: "scene", q: ".*" } }, res, next);
    assert.deepEqual(body.suggestions, []);
  } finally {
    if (oldEngine === undefined) delete process.env.MARKETPLACE_SEARCH_ENGINE;
    else process.env.MARKETPLACE_SEARCH_ENGINE = oldEngine;
  }
});
