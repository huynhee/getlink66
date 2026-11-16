import test from "node:test";
import assert from "node:assert/strict";
import {
  hasMarketplaceAccessFilter,
  marketplaceRankingMetadata,
  shouldPrioritizeMarketplaceModelPro,
} from "../src/utils/marketplaceAccessRanking.js";

test("search reports access-neutral ranking even for a legacy boost request", () => {
  assert.deepEqual(marketplaceRankingMetadata({ applied: true, search: "chair" }), {
    policy: "access_neutral_v3",
    proFirst: false,
    bypassed: true,
    reason: "access_neutral",
  });
});

test("only unfiltered Model browsing prioritizes Pro, including blank input", () => {
  for (const search of [undefined, "", "  "]) {
    assert.equal(shouldPrioritizeMarketplaceModelPro({ search }), true);
    assert.deepEqual(marketplaceRankingMetadata({ search }), {
      policy: "model_browse_pro_first_v3", proFirst: true, bypassed: false,
    });
  }
  assert.equal(shouldPrioritizeMarketplaceModelPro({ search: "chair" }), false);
  assert.equal(shouldPrioritizeMarketplaceModelPro({ assetType: "scene" }), false);
  assert.equal(marketplaceRankingMetadata({ assetType: "scene" }).proFirst, false);
});

test("explicit access filters retain their metadata without enabling a ranking boost", () => {
  for (const accessType of ["free", "pro", "member"]) {
    assert.equal(hasMarketplaceAccessFilter(accessType), true);
    assert.equal(marketplaceRankingMetadata({ accessType }).reason, "access_filter");
    assert.equal(marketplaceRankingMetadata({ accessType }).proFirst, false);
  }
  assert.equal(hasMarketplaceAccessFilter(""), false);
  assert.equal(marketplaceRankingMetadata({ search: "chair" }).reason, "access_neutral");
});
