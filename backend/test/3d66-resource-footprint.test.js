import assert from "node:assert/strict";
import test from "node:test";
import { build3D66FootprintSeed, is3D66FootprintModelPage, selectRewrittenFootprintCard,
  resolveRewrittenFootprintPage, assert3D66RewrittenFootprintLink, footprintLookupKey,
  get3D66VerificationPage } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { manual3D66RequestAllowed } from "../src/utils/3d66VerificationGuard.js";

const paths = {
  "su.3d66.com": "/reshtmla/sketchup/items/fixture/model.html",
  "cad.3d66.com": "/reshtmla/cad/items/fixture/model.html",
  "tietu.3d66.com": "/reshtmla/tietu/items/fixture/model.html",
  "fanganwenben.3d66.com": "/reshtmla/fanganwenben/items/fixture/model.html",
  "xiaoguotu.3d66.com": "/imghtml/items/fixture/model.html",
};
const sourceId = "JCI139810814629725";
const ownId = "JCI896357714629725";
const history = "https://user.3d66.com/newUser/index/index/footprint";

for (const [host, path] of Object.entries(paths)) {
  const base = `https://${host}${path}`;
  const source = `${base}?sof=${sourceId}&sign=sender-fixture&kw=fixture`;
  const clean = `${base}?sof=${ownId}&sign=account-fixture`;

  test(`${host} retains the input URL only for the visit, never as a clean result`, async () => {
    const seed = build3D66FootprintSeed(source + "#tracking");
    assert.equal(seed.sourceFirst, true);
    assert.equal(seed.url, source);
    assert.equal(seed.productId, "ACI896357714629725");
    assert.equal(is3D66FootprintModelPage(source), true);
    assert.throws(() => assert3D66RewrittenFootprintLink(source, seed));
    const visits = [];
    let current;
    const page = { url: () => current, async title() { return "Fixture"; }, async waitForLoadState() {},
      async waitForTimeout() {}, locator() { return { first: () => ({ async waitFor() {} }),
        async evaluateAll(read) { return read([{ href: source }, { href: clean }]); } }; } };
    for (const landing of [source, `https://${host}/`, clean]) {
      visits.length = 0;
      const result = await resolveRewrittenFootprintPage({ page, seed, refreshAttempts: 1,
        async navigate(_page, url) { visits.push(url); current = url === seed.url ? landing : url; } });
      assert.equal(result.url, clean);
      assert.equal(result.productId, ownId);
      assert.deepEqual(visits, [source, history]);
    }
  });

  test(`${host} history requires the complete asset, own account and exactly one signature`, () => {
    const seed = build3D66FootprintSeed(source);
    assert.equal(selectRewrittenFootprintCard([source, clean], seed).url, clean);
    assert.equal(assert3D66RewrittenFootprintLink(clean, seed), ownId);
    for (const wrong of [clean.replace(ownId, "JCI89635771994629725"),
      clean.replace(ownId, "JGI896357714629725"), source,
      clean.replace(host, "su.3d66.com").replace(path, paths["su.3d66.com"])]) {
      if (wrong !== clean) assert.equal(selectRewrittenFootprintCard([wrong], seed), null);
    }
    for (const bad of [clean + "&sof=" + ownId, clean + "&sign=duplicate", clean.replace("account-fixture", ""),
      clean + "&id=" + sourceId]) {
      assert.throws(() => selectRewrittenFootprintCard([bad], seed));
    }
    assert.throws(() => build3D66FootprintSeed(source + "&sign=duplicate"));
    assert.throws(() => build3D66FootprintSeed(source.replace(host, host + ".evil.test")));
  });

  test(`${host} manual verification can resume the source page but not another asset or a purchase`, () => {
    const seed = build3D66FootprintSeed(source);
    const scope = { ...seed, initialUrl: source };
    const req = (url, method = "GET") => ({ url: () => url, method: () => method,
      isNavigationRequest: () => true, frame() { throw new Error("Fixture popup"); } });
    assert.equal(manual3D66RequestAllowed(req(source), scope), true);
    assert.equal(manual3D66RequestAllowed(req(clean), scope), true);
    assert.equal(manual3D66RequestAllowed(req(source.replace("4629725", "9929725")), scope), false);
    assert.equal(manual3D66RequestAllowed(req(source, "POST"), scope), false);
    assert.equal(manual3D66RequestAllowed(req("https://user.3d66.com/api/v1/download/handle"), scope), false);
    assert.notEqual(footprintLookupKey(seed), footprintLookupKey({ ...seed, sourceFirst: false }));
  });
}

test("source-first CAPTCHA is retained before interpreting the redirected model URL", async () => {
  const seed = build3D66FootprintSeed(`https://su.3d66.com${paths["su.3d66.com"]}?sof=${sourceId}`);
  const visits = [];
  const page = { url: () => "https://su.3d66.com/verification", async title() { return "访问验证"; },
    async waitForLoadState() {}, async waitForTimeout() {} };
  await assert.rejects(resolveRewrittenFootprintPage({ page, seed, async navigate(_p, url) { visits.push(url); } }), error => {
    assert.equal(error.details.reason, "upstream_verification_required");
    assert.equal(get3D66VerificationPage(error), page);
    return true;
  });
  assert.deepEqual(visits, [seed.url]);
});

test("effect-image item paths are accepted without accepting lists or cross-resource paths", () => {
  assert.equal(is3D66FootprintModelPage("https://xiaoguotu.3d66.com/items/fixture.html"), true);
  for (const url of ["https://xiaoguotu.3d66.com/lists/fixture.html",
    "https://su.3d66.com/reshtmla/cad/items/fixture/model.html",
    "https://cad.3d66.com/reshtmla/sketchup/items/fixture/model.html"]) {
    assert.equal(is3D66FootprintModelPage(url), false);
  }
});
