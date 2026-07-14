import test from "node:test";
import assert from "node:assert/strict";
import { modelIdsShareAssetIdentity } from "../src/utils/3d66BrowserService.js";

test("matches a footprint model when account markers have different lengths", () => {
  assert.equal(
    modelIdsShareAssetIdentity("FDH456303315848", "ADH89635771315848"),
    true,
  );
  assert.equal(
    modelIdsShareAssetIdentity("IGI996720815561599", "AGI896357715561599"),
    true,
  );
});

test("does not match a different model family or trailing identity", () => {
  assert.equal(
    modelIdsShareAssetIdentity("FDH456303315848", "ACI89635771315848"),
    false,
  );
  assert.equal(
    modelIdsShareAssetIdentity("FDH456303315848", "ADH89635771999999"),
    false,
  );
});
