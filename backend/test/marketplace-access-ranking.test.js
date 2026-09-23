import test from "node:test";
import assert from "node:assert/strict";
import {
  marketplaceRankingMetadata,
  shouldPrioritizeMarketplaceModelPro,
} from "../src/utils/marketplaceAccessRanking.js";

test("unfiltered Model discovery prioritizes Pro while keeping Free", () => {
  assert.equal(shouldPrioritizeMarketplaceModelPro("model", ""), true);
  assert.deepEqual(marketplaceRankingMetadata({ applied: true }), {
    policy: "model_pro_first_v3",
    proFirst: true,
    bypassed: false,
  });
});

test("explicit access filters and Scene discovery bypass the Model default", () => {
  assert.equal(shouldPrioritizeMarketplaceModelPro("model", "free"), false);
  assert.equal(shouldPrioritizeMarketplaceModelPro("model", "member"), false);
  assert.equal(shouldPrioritizeMarketplaceModelPro("scene", ""), false);
  assert.equal(marketplaceRankingMetadata({ applied: false, accessType: "free" }).reason, "access_filter");
  assert.equal(marketplaceRankingMetadata({ applied: false }).reason, "asset_type");
});
