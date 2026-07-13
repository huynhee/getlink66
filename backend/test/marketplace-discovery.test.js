import test from "node:test";
import assert from "node:assert/strict";
import {
  marketplaceContentScore,
  rankMarketplaceRecommendations,
  reciprocalRankFusion,
} from "../src/utils/marketplaceDiscovery.js";

const source = {
  _id: "source",
  categoryId: "chairs",
  parentCategoryId: "furniture",
  renderer: "Corona",
  renderers: ["corona"],
  styles: ["modern"],
  forms: ["organic"],
  colors: ["beige"],
  materials: ["fabric"],
  accessType: "member",
};

test("content discovery prioritizes matching marketplace facets", () => {
  const matching = {
    _id: "matching",
    ...source,
    downloadCount: 20,
    createdAt: new Date().toISOString(),
  };
  const unrelated = {
    _id: "unrelated",
    categoryId: "cars",
    parentCategoryId: "transport",
    renderer: "Vray",
    renderers: ["vray"],
    styles: ["classic"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    accessType: "free",
    downloadCount: 200,
    createdAt: new Date().toISOString(),
  };

  assert.ok(marketplaceContentScore(source, matching) > marketplaceContentScore(source, unrelated));
});

test("semantic and catalog rankings are fused without duplicate models", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    _id: `model-${index}`,
    source: { modelId: `source-${index}` },
    title: `Chair ${index}`,
    categoryId: index < 8 ? "chairs" : "tables",
    parentCategoryId: "furniture",
    renderers: [index % 2 ? "vray" : "corona"],
    styles: ["modern"],
    forms: ["organic"],
    colors: ["beige"],
    materials: ["fabric"],
    downloadCount: index,
  }));
  const result = rankMarketplaceRecommendations(source, candidates, {
    semanticMatches: [{ modelId: "source-10", score: 0.99 }, { modelId: "source-2", score: 0.9 }],
    limit: 6,
  });

  assert.equal(result.length, 6);
  assert.equal(new Set(result.map((item) => item._id)).size, 6);
  assert.ok(result.slice(0, 3).some((item) => item._id === "model-10"));
});

test("reciprocal rank fusion rewards results shared by rankings", () => {
  const scores = reciprocalRankFusion([
    { items: ["a", "b", "c"] },
    { items: ["b", "d", "a"] },
  ]);
  assert.ok(scores.get("b") > scores.get("c"));
  assert.ok(scores.get("a") > scores.get("d"));
});
