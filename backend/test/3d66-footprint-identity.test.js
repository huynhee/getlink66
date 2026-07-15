import test from "node:test";
import assert from "node:assert/strict";
import {
  modelIdsShareAssetIdentity,
  resolvedFootprintUrlMatches,
} from "../src/utils/3d66BrowserService.js";

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

test("accepts the opened footprint URL with or without a sign", () => {
  const unsigned = "https://3d.3d66.com/reshtmla/model/items/id/model.html?sof=ACH89635771994617&st=2";
  const signed = `${unsigned}&sign=6c721841ee48a6bd`;

  assert.equal(resolvedFootprintUrlMatches(unsigned, "HCH03190181994617"), true);
  assert.equal(resolvedFootprintUrlMatches(signed, "HCH03190181994617"), true);
  assert.equal(
    resolvedFootprintUrlMatches(unsigned, "HCI03190181994617"),
    false,
  );
});
