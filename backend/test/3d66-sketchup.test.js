import assert from "node:assert/strict";
import test from "node:test";
import { assert3D66RewrittenFootprintLink, build3D66FootprintSeed, is3D66FootprintModelPage,
  resolveRewrittenFootprintPage, selectRewrittenFootprintCard } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { create3D66HybridResolver } from "../src/utils/3d66HybridResolver.js";
import { manual3D66RequestAllowed } from "../src/utils/3d66VerificationGuard.js";

const base = "https://su.3d66.com/reshtmla/sketchup/items/fixture/SketchUpFixture.html";
const sourceId = "JJI139810814629725";
const accountId = "AJI896357714629725";
const source = `${base}?sof=${sourceId}&sign=sender-fixture&kw=tracking`;
const clean = `${base}?sof=${accountId}&st=2&sign=history-fixture`;
const maxPage = "https://3d.3d66.com/reshtmla/model/items/fixture/SketchUpFixture.html";

test("SketchUp rewriting retains its host, case-sensitive path and complete asset suffix", () => {
  const seed = build3D66FootprintSeed(source);
  assert.deepEqual(seed, { sourceProductId: sourceId, productId: accountId, modelPage: base,
    url: `${base}?sof=${accountId}&st=2` });
  assert.equal(assert3D66RewrittenFootprintLink(clean, seed), accountId);
  assert.equal(is3D66FootprintModelPage(base), true);
  assert.equal(is3D66FootprintModelPage(maxPage), true);
});

test("SketchUp support does not admit wrong host/path pairs or relax account/signature validation", () => {
  for (const value of [base.replace("sketchup", "model"), maxPage.replace("model/items", "sketchup/items"),
    base.replace("https:", "http:"), base.replace("su.3d66.com", "su.3d66.com.evil.test"),
    base.replace("su.3d66.com", "user:pass@su.3d66.com"), base.replace("su.3d66.com", "su.3d66.com:8443"),
    "https://su.3d66.com/reshtmla/sketchup/items/id/model.html"]) {
    assert.equal(is3D66FootprintModelPage(value), false);
    assert.throws(() => build3D66FootprintSeed(`${value}?sof=${sourceId}`));
  }
  const seed = build3D66FootprintSeed(source);
  for (const value of [clean.replace(accountId, sourceId), clean.replace(accountId, "AJI89635771994629725"),
    clean + `&sof=${accountId}`, clean + "&sign=duplicate", clean.replace("history-fixture", ""),
    clean.replace("history-fixture", "%20"), clean + "&id=wrong"]) {
    assert.throws(() => assert3D66RewrittenFootprintLink(value, seed));
  }
});

test("history selects SketchUp rather than a Max resource sharing the same full ID", () => {
  const seed = build3D66FootprintSeed(source);
  const maxLink = clean.replace(base, maxPage);
  const canonical = clean.replace("SketchUpFixture", "AccountCanonical");
  assert.equal(selectRewrittenFootprintCard([maxLink, canonical], seed).url, canonical);
  assert.equal(selectRewrittenFootprintCard([maxLink], seed), null);
  assert.throws(() => assert3D66RewrittenFootprintLink(maxLink, { ...seed, modelPage: maxPage }));
  const maxSeed = build3D66FootprintSeed(source.replace(base, maxPage));
  assert.equal(selectRewrittenFootprintCard([clean, maxLink], maxSeed).url, maxLink);
});

test("SketchUp seed may return home before looking up the signed history entry", async () => {
  const seed = build3D66FootprintSeed(source);
  const history = "https://user.3d66.com/newUser/index/index/footprint";
  for (const home of ["https://www.3d66.com/", "https://su.3d66.com/"]) {
    let current;
    const visits = [];
    const page = { url: () => current, async title() { return "Fixture"; }, async waitForLoadState() {},
      async waitForTimeout() {}, locator() { return { first() { return { async waitFor() {} }; },
        async evaluateAll(read) { return read([{ href: clean }]); } }; } };
    const result = await resolveRewrittenFootprintPage({ page, seed, async navigate(_page, url) {
      visits.push(url); current = url === seed.url ? home : url;
    } });
    assert.equal(result.url, clean);
    assert.deepEqual(visits, [seed.url, history]);
    assert.ok(!visits.includes(source));
  }
});

test("manual SketchUp verification remains bound to its resource and blocks purchase APIs", () => {
  const seed = build3D66FootprintSeed(source);
  const scope = { productId: seed.productId, modelPage: seed.modelPage, initialUrl: seed.url };
  const request = (url, method = "GET") => ({ url: () => url, method: () => method,
    isNavigationRequest: () => true, frame() { throw new Error("Fixture popup has no frame yet"); } });
  assert.equal(manual3D66RequestAllowed(request(clean), scope), true);
  assert.equal(manual3D66RequestAllowed(request(clean.replace("SketchUpFixture", "Canonical")), scope), true);
  for (const value of [clean.replace(base, maxPage), clean.replace(accountId, sourceId),
    clean + `&sof=${accountId}`, "https://user.3d66.com/api/v1/download/handle"]) {
    assert.equal(manual3D66RequestAllowed(request(value), scope), false);
  }
  assert.equal(manual3D66RequestAllowed(request(clean, "POST"), scope), false);
});

test("shared hybrid validation and cache cannot cross from SketchUp to Max with an identical ID", async () => {
  let reads = 0;
  const resolver = create3D66HybridResolver({ readMetadata: async () => { reads++; return {}; },
    openModel: async () => ({ url: clean }) });
  assert.equal((await resolver.resolve(source, "fixture-cookie")).url, clean);
  await assert.rejects(resolver.resolve(source.replace(base, maxPage), "fixture-cookie"),
    error => error.code === "THREED66_HYBRID_INPUT_INVALID" && error.details.reason === "resolved_model_mismatch");
  assert.equal(reads, 2);
});
