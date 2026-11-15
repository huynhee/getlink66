import test from "node:test";
import assert from "node:assert/strict";
import {
  hasMarketplaceAccessFilter,
  marketplaceRankingMetadata,
} from "../src/utils/marketplaceAccessRanking.js";

test("catalog discovery reports access-neutral ranking even for a legacy boost request", () => {
  assert.deepEqual(marketplaceRankingMetadata({ applied: true }), {
    policy: "access_neutral_v3",
    proFirst: false,
    bypassed: true,
    reason: "access_neutral",
  });
});

test("explicit access filters retain their metadata without enabling a ranking boost", () => {
  for (const accessType of ["free", "pro", "member"]) {
    assert.equal(hasMarketplaceAccessFilter(accessType), true);
    assert.equal(marketplaceRankingMetadata({ accessType }).reason, "access_filter");
    assert.equal(marketplaceRankingMetadata({ accessType }).proFirst, false);
  }
  assert.equal(hasMarketplaceAccessFilter(""), false);
  assert.equal(marketplaceRankingMetadata().reason, "access_neutral");
});
