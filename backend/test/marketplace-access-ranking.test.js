import test from "node:test";
import assert from "node:assert/strict";
import {
  marketplaceRankingMetadata,
  shouldDefaultMarketplaceModelToPro,
} from "../src/utils/marketplaceAccessRanking.js";

test("unfiltered Model discovery defaults to Pro only", () => {
  assert.equal(shouldDefaultMarketplaceModelToPro("model", ""), true);
  assert.deepEqual(marketplaceRankingMetadata({ applied: true }), {
    policy: "model_pro_only_v2",
    defaultAccessType: "member",
    bypassed: false,
  });
});

test("explicit access filters and Scene discovery bypass the Model default", () => {
  assert.equal(shouldDefaultMarketplaceModelToPro("model", "free"), false);
  assert.equal(shouldDefaultMarketplaceModelToPro("model", "member"), false);
  assert.equal(shouldDefaultMarketplaceModelToPro("scene", ""), false);
  assert.equal(marketplaceRankingMetadata({ applied: false, accessType: "free" }).reason, "access_filter");
  assert.equal(marketplaceRankingMetadata({ applied: false }).reason, "asset_type");
});
