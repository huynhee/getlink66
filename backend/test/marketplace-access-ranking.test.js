import test from "node:test";
import assert from "node:assert/strict";
import { marketplaceRankingMetadata } from "../src/utils/marketplaceAccessRanking.js";

test("unfiltered Model discovery ranks Free and Pro together", () => {
  assert.deepEqual(marketplaceRankingMetadata(), {
    policy: "model_mixed_access_v4",
    proFirst: false,
    bypassed: false,
  });
});

test("explicit access filters and Scene discovery report their scope", () => {
  assert.equal(marketplaceRankingMetadata({ accessType: "free" }).reason, "access_filter");
  assert.equal(marketplaceRankingMetadata({ accessType: "member" }).reason, "access_filter");
  assert.equal(marketplaceRankingMetadata({ assetType: "scene" }).reason, "asset_type");
});
