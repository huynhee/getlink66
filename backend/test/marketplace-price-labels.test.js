import test from "node:test";
import assert from "node:assert/strict";
import { marketplacePriceLabels } from "../../frontend/src/utils/marketplacePriceLabels.js";

test("marketplace copy uses configured prices rather than legacy defaults", () => {
  assert.deepEqual(marketplacePriceLabels({ marketplaceModelCreditPrice: 7, marketplaceSceneCreditPrice: 20 }), {
    model: "7", scene: "20"
  });
  assert.equal(marketplacePriceLabels({ marketplaceSceneCreditPrice: "15" }).scene, "15");
});

test("unknown or invalid prices never advertise a hard-coded charge", () => {
  assert.deepEqual(marketplacePriceLabels(), { model: "...", scene: "..." });
  for (const value of [null, "", -1, 0, 1.5, "bad", Infinity]) {
    assert.equal(marketplacePriceLabels({ marketplaceSceneCreditPrice: value }).scene, "...");
  }
});
