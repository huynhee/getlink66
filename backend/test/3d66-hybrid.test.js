import assert from "node:assert/strict";
import test from "node:test";
import { create3D66HybridResolver, validate3D66HybridInput } from "../src/utils/3d66HybridResolver.js";
import { build3D66FootprintSeed } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { isSwitchable3D66Error } from "../src/utils/3d66CookiePool.js";

const input = "https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=BJI010779713376927&sign=source-fixture";
const clean = "https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=AJI896357713376927&sign=account-fixture";
const format = { key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4" };

function fixture(t, { formats = [], clock = () => Date.now() } = {}) {
  const previous = process.env.THREED66_REQUIRED_ACCOUNT_MARKER;
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "89635771";
  t.after(() => {
    if (previous === undefined) delete process.env.THREED66_REQUIRED_ACCOUNT_MARKER;
    else process.env.THREED66_REQUIRED_ACCOUNT_MARKER = previous;
  });
  const calls = { api: 0, browser: [], config: "config-1" };
  const resolver = create3D66HybridResolver({ now: clock, configurationKey: () => calls.config,
    readMetadata: async () => { calls.api++; return { title: "Fixture", creditCost: 28, priceKnown: true, formatOptions: formats,
      formatOptionsSource: "api", formatOptionsComplete: formats.length > 0 }; },
    openModel: async (url, cookie, options) => {
      calls.browser.push({ url, cookie, options });
      const seed = build3D66FootprintSeed(url);
      return { url: options.resolvedLink?.url || `${seed.modelPage}?sof=${seed.productId}&sign=fixture`,
        inspection: options.includeFormatOptions ? { metadata: { formatOptions: [format] }, formatsChecked: true } : undefined };
    },
  });
  return { resolver, calls };
}

test("hybrid progressive metadata reads no browser and never authorizes the foreign URL", async t => {
  const { resolver, calls } = fixture(t, { formats: [format] });
  await resolver.read(input, "cookie-A");
  assert.equal(calls.browser.length, 0);
  const result = await resolver.prepare(input, "cookie-A");
  assert.equal(calls.api, 1);
  assert.equal(calls.browser.length, 1);
  assert.equal(calls.browser[0].options.resolvedLink, null);
  assert.equal(new URL(result.url).searchParams.get("sof"), "AJI896357713376927");
});

test("an account-signed input with real API choices skips all browser/history work", async t => {
  const { resolver, calls } = fixture(t, { formats: [format] });
  const result = await resolver.prepare(clean, "cookie-A");
  assert.equal(result.url, clean);
  assert.equal(calls.browser.length, 0);
  assert.equal(calls.api, 1);
});

test("a signed input missing API formats only opens its verified page, never a rewrite seed", async t => {
  const { resolver, calls } = fixture(t);
  await resolver.prepare(clean, "cookie-A");
  assert.equal(calls.browser.length, 1);
  assert.equal(calls.browser[0].options.resolvedLink.url, clean);
});

test("parallel preparation coalesces API reads and browser navigation", async t => {
  const { resolver, calls } = fixture(t);
  const [a, b, c] = await Promise.all([resolver.prepare(input, "cookie-A"), resolver.prepare(input, "cookie-A"), resolver.prepare(input, "cookie-A")]);
  assert.equal(a.url, b.url);
  assert.equal(b.url, c.url);
  assert.equal(calls.api, 1);
  assert.equal(calls.browser.length, 1);
});

test("verified links expire at two minutes and cannot cross cookie or configuration boundaries", async t => {
  let now = 1000;
  const { resolver, calls } = fixture(t, { clock: () => now });
  await resolver.prepare(input, "cookie-A");
  now += 119999;
  await resolver.prepare(input, "cookie-A");
  assert.equal(calls.browser.length, 1);
  now++;
  await resolver.prepare(input, "cookie-A");
  assert.equal(calls.browser.length, 2);
  await resolver.prepare(input, "cookie-B");
  assert.equal(calls.browser.length, 3);
  calls.config = "config-2";
  await resolver.prepare(input, "cookie-B");
  assert.equal(calls.browser.length, 4);
});

for (const suffix of ["&sof=BJI010779713376927", "&sign=second", "&id=another", "&id=BJI010779713376927&id=BJI010779713376927"]) {
  test(`hybrid rejects ambiguous source fields before any IO: ${suffix}`, () => {
    assert.throws(() => validate3D66HybridInput(input + suffix), { code: "THREED66_HYBRID_INPUT_INVALID" });
  });
}

test("a wrong account, missing signature, or another model cannot enter verified cache", async t => {
  const { resolver } = fixture(t);
  for (const url of [input, clean.replace("&sign=account-fixture", ""), clean.replace("3376927", "9999999"), clean + "&sof=AJI896357713376927"]) {
    assert.throws(() => resolver.remember(input, { url }, "cookie-A"), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  }
});

test("a rejected browser result is never cached or silently replaced with the input", async () => {
  let opened = 0;
  const resolver = create3D66HybridResolver({ readMetadata: async () => null,
    openModel: async () => { opened++; return { url: input }; } });
  await assert.rejects(resolver.prepare(input, "cookie-A"), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  await assert.rejects(resolver.prepare(input, "cookie-A"), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.equal(opened, 2);
});

test("verification failures stop preparation and do not cause cookie switching", async () => {
  let opened = 0;
  const failure = Object.assign(new Error("Verification required"), { status: 403, code: "THREED66_HYBRID_VERIFICATION_REQUIRED" });
  const resolver = create3D66HybridResolver({ readMetadata: async () => { throw failure; }, openModel: async () => { opened++; } });
  await assert.rejects(resolver.prepare(input, "cookie-A"), error => error === failure);
  assert.equal(opened, 0);
  assert.equal(isSwitchable3D66Error(failure), false);
});

test("failed preparations release coalescing entries so a manual retry can succeed", async () => {
  let tries = 0;
  const resolver = create3D66HybridResolver({ readMetadata: async () => null,
    openModel: async () => { if (!tries++) throw new Error("Temporary fixture failure"); return { url: clean, inspection: { formatsChecked: true, metadata: { formatOptions: [] } } }; } });
  await assert.rejects(resolver.prepare(input, "cookie-A"));
  const result = await resolver.prepare(input, "cookie-A");
  assert.deepEqual(result.inspection.metadata.formatOptions, []);
  assert.equal(tries, 2);
});

test("configuration changes during a browser operation cannot publish a result into the new scope", async () => {
  let config = "before";
  const resolver = create3D66HybridResolver({ configurationKey: () => config, readMetadata: async () => null,
    openModel: async () => { config = "after"; return { url: clean, inspection: { formatsChecked: true, metadata: { formatOptions: [] } } }; } });
  await assert.rejects(resolver.prepare(input, "cookie-A"), { code: "THREED66_HYBRID_CONFIGURATION_CHANGED" });
});

test("partial API format metadata cannot skip the real page selector", async () => {
  let opened = 0;
  const resolver = create3D66HybridResolver({ readMetadata: async () => ({ formatOptions: [format], formatOptionsSource: "api" }),
    openModel: async () => { opened++; return { url: clean, inspection: { formatsChecked: true, metadata: { formatOptions: [format] } } }; } });
  await resolver.prepare(clean, "cookie-A");
  assert.equal(opened, 1);
});

test("models sharing only five trailing digits cannot enter the verified cache", async t => {
  const { resolver } = fixture(t);
  const other = clean.replace("13376927", "19976927");
  assert.throws(() => resolver.remember(input, { url: other }, "cookie-A"), {
    code: "THREED66_HYBRID_INPUT_INVALID",
    details: { stage: "hybrid-input", reason: "resolved_model_mismatch" },
  });
});

test("an owned URL retains its exact asset suffix with a non-eight-digit account marker", async t => {
  fixture(t);
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "123456789";
  const owned = clean.replace("89635771", "123456789");
  const seed = validate3D66HybridInput(owned);
  assert.equal(seed.productId, "AJI1234567893376927");
  const resolver = create3D66HybridResolver({ readMetadata: async () => ({
    formatOptionsSource: "api", formatOptionsComplete: true, formatOptions: [],
  }), openModel: () => assert.fail("A complete owned link must not open Chromium") });
  assert.equal((await resolver.prepare(owned, "cookie-A")).url, owned);
});

test("API-supplied signed URLs still require the exact asset and account identity", async t => {
  fixture(t);
  for (const verifiedModelUrl of [clean, clean.replace("13376927", "19976927"), input]) {
    let opened = 0;
    const resolver = create3D66HybridResolver({ readMetadata: async () => ({ verifiedModelUrl,
      formatOptionsSource: "api", formatOptionsComplete: true, formatOptions: [],
    }), openModel: async () => { opened++; return { url: clean, inspection: { formatsChecked: true } }; } });
    const result = await resolver.prepare(input, "cookie-A");
    assert.equal(result.url, clean);
    assert.equal(opened, verifiedModelUrl === clean ? 0 : 1);
  }
});
