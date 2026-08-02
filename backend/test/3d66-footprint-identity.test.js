import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafe3D66Url,
  isAllowed3D66BrowserRequestUrl,
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
  assert.equal(
    modelIdsShareAssetIdentity("FBG45630336091", "ABG8963577136091"),
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
  assert.equal(
    modelIdsShareAssetIdentity("FBG45630336091", "ABG8963577196092"),
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

test("browser requests stay on the explicit 3D66 allowlist", () => {
  assert.equal(isAllowed3D66BrowserRequestUrl("https://www.3d66.com/model/123"), true);
  assert.equal(isAllowed3D66BrowserRequestUrl("https://res.3d66.com/app.js"), true);
  assert.equal(isAllowed3D66BrowserRequestUrl("https://3d66.com.evil.test/"), false);
  assert.equal(isAllowed3D66BrowserRequestUrl("http://127.0.0.1:5000/private"), false);
  assert.equal(isAllowed3D66BrowserRequestUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowed3D66BrowserRequestUrl("file:///etc/passwd"), false);
  assert.throws(
    () => assertSafe3D66Url("https://user:pass@3d66.com/model/123"),
    /credentials are not allowed/,
  );
});

test("browser request allowlist supports exact configured CDN hosts", () => {
  const previous = process.env.THREED66_BROWSER_ALLOWED_HOSTS;
  process.env.THREED66_BROWSER_ALLOWED_HOSTS = "cdn.example.test";
  try {
    assert.equal(isAllowed3D66BrowserRequestUrl("https://cdn.example.test/app.js"), true);
    assert.equal(isAllowed3D66BrowserRequestUrl("https://sub.cdn.example.test/app.js"), false);
  } finally {
    if (previous === undefined) delete process.env.THREED66_BROWSER_ALLOWED_HOSTS;
    else process.env.THREED66_BROWSER_ALLOWED_HOSTS = previous;
  }
});
