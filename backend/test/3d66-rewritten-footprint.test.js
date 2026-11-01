import assert from "node:assert/strict";
import test from "node:test";
import { build3D66FootprintSeed, assert3D66RewrittenFootprintLink, selectRewrittenFootprintLink,
  resolveRewrittenFootprintPage, create3D66RewrittenFootprintResolver } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { assert3D66CleanModelUrl } from "../src/utils/3d66CleanLink.js";
import { isSwitchable3D66Error, shouldDegrade3D66Cookie } from "../src/utils/3d66CookiePool.js";

const sourceId = "GCI139810814629725";
const accountId = "ACI896357714629725";
const base = "https://3d.3d66.com/reshtmla/model/items/qP/FixtureCaseSensitive.html";
const source = `${base}?sof=${sourceId}&sign=old-fixture&action_id=old&p=32#tracking`;
const seed = build3D66FootprintSeed(source);
const clean = `${base}?sof=${accountId}&st=2&sign=fresh-fixture`;
const historyUrl = "https://user.3d66.com/newUser/index/index/footprint";

function setEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function fixture(options = {}) {
  let current = "about:blank";
  let reads = 0;
  const actions = [];
  const page = {
    url: () => current,
    async waitForLoadState() {},
    async waitForTimeout() {},
    locator() {
      return {
        first() { return { async waitFor() {} }; },
        async evaluateAll(read) {
          reads += 1;
          const links = typeof options.links === "function" ? options.links(reads) : options.links || [clean];
          return read(links.map((href) => ({ href })));
        },
      };
    },
  };
  async function navigate(_page, href) {
    actions.push(href);
    if (options.networkError) throw new Error("Fixture network failure");
    current = options.redirects?.[href] || href;
  }
  return { page, navigate, actions };
}

test("rewrite changes only the first letter and eight sender digits, preserving the entire suffix and path", () => {
  assert.deepEqual(seed, { sourceProductId: sourceId, productId: accountId, modelPage: base,
    url: `${base}?sof=${accountId}&st2` });
  assert.equal(new URL(seed.url).hash, "");
  assert.deepEqual([...new URL(seed.url).searchParams.keys()], ["sof", "st2"]);
  assert.equal(build3D66FootprintSeed(`${base}?sof=ZGI000012340001234`).productId, "AGI896357710001234");
  assert.equal(build3D66FootprintSeed(`${base}?sof=${accountId}`).productId, accountId);
  assert.throws(() => assert3D66CleanModelUrl(seed.url), { code: "THREED66_CLEAN_LINK_REQUIRED" });
});

test("rewrite honors the required marker without depending on the legacy search marker", (t) => {
  setEnv(t, "THREED66_REQUIRED_ACCOUNT_MARKER", "123456789");
  setEnv(t, "THREED66_ACCOUNT_MARKER", "99999999");
  assert.equal(build3D66FootprintSeed(source).productId, "ACI1234567894629725");
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "";
  assert.throws(() => build3D66FootprintSeed(source), { code: "THREED66_CLEAN_LINK_REQUIRED", status: 503 });
});

test("rewrite rejects ambiguous IDs, missing suffixes, unsafe URLs and synthetic model pages", () => {
  for (const value of [source.replace("https:", "http:"), source.replace("3d.3d66.com", "evil.test"),
    source.replace("3d.3d66.com", "3d.3d66.com.evil.test"), source.replace("3d.3d66.com", "user:pass@3d.3d66.com"),
    source.replace("3d.3d66.com", "3d.3d66.com:8443"), source.replace("3d.3d66.com", "cad.3d66.com"),
    `${base}?sof=${sourceId}&sof=${sourceId}`, `${base}?sof=${sourceId}&id=wrong`,
    `${base}?sof=${sourceId}&id=${sourceId}&id=${sourceId}`, base, `${base}?sof=GCI139810811234`,
    "https://3d.3d66.com/reshtmla/model/items/id/model.html?sof=" + sourceId, sourceId]) {
    assert.throws(() => build3D66FootprintSeed(value), { code: "THREED66_REWRITTEN_FOOTPRINT_FAILED", status: 400 });
  }
});

test("history selection requires the exact case-sensitive path and complete rewritten ID, not a shared suffix", () => {
  const otherPath = clean.replace("FixtureCaseSensitive", "fixturecasesensitive");
  const wrongFamily = clean.replace(accountId, "AGI896357714629725");
  const longerSuffix = clean.replace(accountId, "ACI89635771994629725");
  const oldAccount = clean.replace(accountId, sourceId);
  assert.equal(selectRewrittenFootprintLink([otherPath, wrongFamily, longerSuffix, oldAccount], seed), null);
  assert.equal(selectRewrittenFootprintLink([otherPath, longerSuffix, clean], seed).url, clean);
  assert.throws(() => assert3D66RewrittenFootprintLink(otherPath, seed));
  assert.throws(() => assert3D66RewrittenFootprintLink(longerSuffix, seed));
});

test("an exact history entry still requires exactly one real signature and consistent IDs", () => {
  for (const value of [seed.url, clean.replace("fresh-fixture", ""), `${clean}&sign=duplicate`,
    `${clean}&sof=${sourceId}`, `${clean}&id=${sourceId}`, clean.replace("fresh-fixture", "%20"),
    clean.replace("https://", "https://user:pass@")]) {
    assert.throws(() => selectRewrittenFootprintLink([value], seed), undefined, value);
  }
  assert.equal(selectRewrittenFootprintLink([clean.replace("https:", "http:")], seed), null);
});

test("an empty seed page can be followed by a signed history URL without opening or purchasing the seed", async () => {
  const state = fixture();
  assert.deepEqual(await resolveRewrittenFootprintPage({ ...state, seed }),
    { url: clean, productId: accountId, usedFootprint: true });
  assert.deepEqual(state.actions, [seed.url, historyUrl]);
  assert.ok(!state.actions.includes(source));
});

test("history refresh is bounded and never revisits the original or seed on a miss", async () => {
  const delayed = fixture({ links: (read) => read === 2 ? [clean] : [] });
  assert.equal((await resolveRewrittenFootprintPage({ ...delayed, seed, refreshAttempts: 3 })).url, clean);
  assert.deepEqual(delayed.actions, [seed.url, historyUrl, historyUrl]);
  const missing = fixture({ links: [clean.replace("FixtureCaseSensitive", "other")] });
  await assert.rejects(resolveRewrittenFootprintPage({ ...missing, seed, refreshAttempts: 2 }),
    (error) => error.details.reason === "signed_model_not_found_in_history");
  assert.deepEqual(missing.actions, [seed.url, historyUrl, historyUrl]);
});

test("seed/history redirects fail closed even when the other model shares the same suffix", async () => {
  for (const [from, to] of [[seed.url, seed.url.replace("FixtureCaseSensitive", "other")],
    [seed.url, seed.url.replace(accountId, "ACI89635771994629725")],
    [historyUrl, "https://user.3d66.com/login"], [historyUrl, "https://evil.test/footprint"]]) {
    const state = fixture({ redirects: { [from]: to } });
    await assert.rejects(resolveRewrittenFootprintPage({ ...state, seed }));
  }
});

test("failures never retry with another proxy/account or degrade a healthy cookie", async () => {
  const state = fixture({ networkError: true });
  let calls = 0;
  const resolver = create3D66RewrittenFootprintResolver({ ...state, serializeCookies: () => "unused",
    withBrowserContext: async (url, _cookie, callback, options) => {
      calls += 1;
      assert.equal(url, seed.url);
      assert.equal(options.allowProxyFallback, false);
      return callback({ page: state.page, context: {} });
    } });
  await assert.rejects(resolver(source, "fixture-cookie"), (error) => {
    assert.equal(error.code, "THREED66_REWRITTEN_FOOTPRINT_FAILED");
    assert.equal(error.details.reason, "history_operation_interrupted");
    assert.equal(isSwitchable3D66Error(error), false);
    assert.equal(shouldDegrade3D66Cookie(error), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("simultaneous identical requests share a task; cookies and required markers isolate tasks", async (t) => {
  let calls = 0;
  const resolver = create3D66RewrittenFootprintResolver({ navigate: async () => {}, serializeCookies: () => "updated",
    withBrowserContext: async (url, cookie) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { url, cookie };
    } });
  const same = await Promise.all([resolver(source, "a"), resolver(source, "a")]);
  assert.equal(calls, 1);
  assert.deepEqual(same[0], same[1]);
  await Promise.all([resolver(source, "a"), resolver(source, "b")]);
  assert.equal(calls, 3);
  const first = resolver(source, "a");
  setEnv(t, "THREED66_REQUIRED_ACCOUNT_MARKER", "12345678");
  await Promise.all([first, resolver(source, "a")]);
  assert.equal(calls, 5);
});

test("failed pending tasks are removed, allowing a later explicit retry", async () => {
  let calls = 0;
  const resolver = create3D66RewrittenFootprintResolver({ navigate: async () => {}, serializeCookies: () => "",
    withBrowserContext: async () => {
      if (++calls === 1) throw new Error("Fixture failure");
      return { url: clean };
    } });
  await assert.rejects(resolver(source, "cookie"));
  assert.equal((await resolver(source, "cookie")).url, clean);
  assert.equal(calls, 2);
});
