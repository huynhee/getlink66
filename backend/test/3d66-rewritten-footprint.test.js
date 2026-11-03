import assert from "node:assert/strict";
import test from "node:test";
import { build3D66FootprintSeed, assert3D66RewrittenFootprintLink, selectRewrittenFootprintCard,
  resolveRewrittenFootprintPage, create3D66RewrittenFootprintResolver,
  assert3D66FootprintPageVerified } from "../src/utils/3d66RewrittenFootprintResolver.js";
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
    async title() { return options.challengeAt === current ? "滑动验证页面" : "Fixture model"; },
    async waitForLoadState() {},
    async waitForTimeout() { if (current === seed.url && options.settledLanding) current = options.settledLanding; },
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
    if (options.navigationError && href === seed.url) throw options.navigationError;
  }
  return { page, navigate, actions };
}

test("rewrite changes only the first letter and eight sender digits, preserving the entire suffix and path", () => {
  assert.deepEqual(seed, { sourceProductId: sourceId, productId: accountId, modelPage: base,
    url: `${base}?sof=${accountId}&st=2` });
  assert.equal(new URL(seed.url).hash, "");
  assert.deepEqual([...new URL(seed.url).searchParams.keys()], ["sof", "st"]);
  assert.equal(new URL(seed.url).searchParams.get("st"), "2");
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

test("short public model IDs gain the configured marker without losing any asset digits", () => {
  assert.equal(build3D66FootprintSeed(`${base}?sof=AJI7972535`).productId, "AJI896357717972535");
  assert.throws(() => build3D66FootprintSeed(`${base}?sof=AJI12345678901`), { status: 400 });
});

test("seed serializes st=2 and never preserves a malformed st2 flag or caller-supplied navigation parameters", () => {
  for (const query of ["st2", "st=1", "st=2&st=9&st2", "st%3D2&sign=old-fixture"]) {
    const result = build3D66FootprintSeed(`${base}?sof=AJI7972535&${query}`);
    assert.equal(result.url, `${base}?sof=AJI896357717972535&st=2`);
    assert.equal(new URL(result.url).searchParams.has("st2"), false);
  }
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

test("history may supply a canonical path but must match the complete rewritten ID, not a shared suffix", () => {
  const otherPath = clean.replace("FixtureCaseSensitive", "fixturecasesensitive");
  const wrongFamily = clean.replace(accountId, "AGI896357714629725");
  const longerSuffix = clean.replace(accountId, "ACI89635771994629725");
  const oldAccount = clean.replace(accountId, sourceId);
  assert.equal(selectRewrittenFootprintCard([wrongFamily, longerSuffix, oldAccount], seed), null);
  assert.equal(selectRewrittenFootprintCard([longerSuffix, otherPath, clean], seed).url, otherPath);
  assert.throws(() => assert3D66RewrittenFootprintLink(otherPath, seed));
  assert.throws(() => assert3D66RewrittenFootprintLink(longerSuffix, seed));
});

test("unsigned cards can be opened, but malformed signatures and conflicting IDs are never accepted", () => {
  assert.equal(selectRewrittenFootprintCard([seed.url], seed).url, seed.url);
  for (const value of [clean.replace("fresh-fixture", ""), `${clean}&sign=duplicate`,
    `${clean}&sof=${sourceId}`, `${clean}&id=${sourceId}`, clean.replace("fresh-fixture", "%20"),
    clean.replace("https://", "https://user:pass@")]) {
    assert.throws(() => selectRewrittenFootprintCard([value], seed), undefined, value);
  }
  assert.throws(() => selectRewrittenFootprintCard([clean.replace("https:", "http:")], seed));
});

test("an empty seed page can be followed by a signed history URL without opening or purchasing the seed", async () => {
  const state = fixture();
  assert.deepEqual(await resolveRewrittenFootprintPage({ ...state, seed }),
    { url: clean, productId: accountId, usedFootprint: true, canonicalModelPage: base });
  assert.deepEqual(state.actions, [seed.url, historyUrl]);
  assert.ok(!state.actions.includes(source));
});

for (const home of ["https://3d66.com/", "https://www.3d66.com/", "https://3d.3d66.com/"]) {
  test(`a seed landing on ${home} continues only through its exact signed history item`, async () => {
    const canonical = clean.replace("FixtureCaseSensitive", "AccountCanonical");
    const unsigned = canonical.replace("&sign=fresh-fixture", "");
    const state = fixture({ redirects: { [seed.url]: home }, links: [unsigned] });
    let opens = 0;
    const result = await resolveRewrittenFootprintPage({ ...state, seed, openHistoryLink: async (_page, card, boundSeed) => {
      opens++;
      assert.equal(card.url, unsigned);
      assert.equal(boundSeed.productId, accountId);
      return canonical;
    } });
    assert.equal(result.url, canonical);
    assert.equal(opens, 1);
    assert.deepEqual(state.actions, [seed.url, historyUrl]);
    assert.ok(!state.actions.includes(source));
  });
}

test("seed redirects settle before validation and an interrupted source-home redirect is not visited twice", async () => {
  for (const navigationError of [undefined, new Error("page.goto: net::ERR_ABORTED at signed-secret-url"),
    new Error("Navigation to signed-secret-url is interrupted by another navigation to source-home")]) {
    const state = fixture({ settledLanding: "https://www.3d66.com/", navigationError });
    assert.equal((await resolveRewrittenFootprintPage({ ...state, seed })).url, clean);
    assert.deepEqual(state.actions, [seed.url, historyUrl]);
  }
});

test("home is only an intermediate landing, never evidence of a model or a completed verification", async () => {
  const home = "https://www.3d66.com/";
  const missing = fixture({ redirects: { [seed.url]: home }, links: [] });
  await assert.rejects(resolveRewrittenFootprintPage({ ...missing, seed, refreshAttempts: 1 }),
    error => error.details.reason === "signed_model_not_found_in_history");
  assert.deepEqual(missing.actions, [seed.url, historyUrl]);
  const blocked = fixture({ redirects: { [seed.url]: home }, challengeAt: home });
  await assert.rejects(resolveRewrittenFootprintPage({ ...blocked, seed }),
    error => error.status === 403 && error.details.reason === "upstream_verification_required");
  assert.deepEqual(blocked.actions, [seed.url]);
});

test("seed interruptions on the model page, timeouts and unsafe home redirects do not authorize history", async () => {
  for (const options of [{ navigationError: new Error("net::ERR_ABORTED") },
    { redirects: { [seed.url]: "https://www.3d66.com/" }, navigationError: Object.assign(new Error("timeout"), { name: "TimeoutError" }) },
    ...["https://evil.test/", "https://www.3d66.com.evil.test/", "http://www.3d66.com/",
      "https://user:pass@www.3d66.com/", "https://www.3d66.com:8443/", "https://www.3d66.com/login",
      "https://www.3d66.com/?sof=wrong"].map(home => ({ redirects: { [seed.url]: home } }))]) {
    const state = fixture(options);
    await assert.rejects(resolveRewrittenFootprintPage({ ...state, seed }));
    assert.deepEqual(state.actions, [seed.url]);
  }
});

for (const challengeAt of [seed.url, historyUrl]) {
  test(`verification at ${challengeAt === seed.url ? "the rewritten seed" : "history"} stops before looking up or opening another model`, async () => {
    const state = fixture({ challengeAt });
    let opens = 0;
    await assert.rejects(resolveRewrittenFootprintPage({ ...state, seed, openHistoryLink: async () => { opens += 1; } }),
      (error) => error.status === 403 && error.details.reason === "upstream_verification_required"
        && !isSwitchable3D66Error(error) && !shouldDegrade3D66Cookie(error));
    assert.equal(opens, 0);
    assert.equal(state.actions.length, challengeAt === seed.url ? 1 : 2);
  });
}

test("ordinary model titles mentioning verification are not treated as a challenge page", async () => {
  await assert.doesNotReject(assert3D66FootprintPageVerified({ async title() { return "Captcha decoration - 3D model"; } }));
});

test("history refresh is bounded and never revisits the original or seed on a miss", async () => {
  const delayed = fixture({ links: (read) => read === 2 ? [clean] : [] });
  assert.equal((await resolveRewrittenFootprintPage({ ...delayed, seed, refreshAttempts: 3 })).url, clean);
  assert.deepEqual(delayed.actions, [seed.url, historyUrl, historyUrl]);
  const missing = fixture({ links: [clean.replace(accountId, "ACI89635771994629725")] });
  await assert.rejects(resolveRewrittenFootprintPage({ ...missing, seed, refreshAttempts: 2 }),
    (error) => error.details.reason === "signed_model_not_found_in_history");
  assert.deepEqual(missing.actions, [seed.url, historyUrl, historyUrl]);
});

test("seed/history redirects fail closed even when the other model shares the same suffix", async () => {
  for (const [from, to] of [[seed.url, seed.url.replace(accountId, "ACI89635771994629725")],
    [historyUrl, "https://user.3d66.com/login"], [historyUrl, "https://evil.test/footprint"]]) {
    const state = fixture({ redirects: { [from]: to } });
    await assert.rejects(resolveRewrittenFootprintPage({ ...state, seed }));
  }
});

test("the exact unsigned history card is opened to obtain the real signature on its canonical path", async () => {
  const canonical = clean.replace("FixtureCaseSensitive", "AccountCanonical");
  const unsigned = canonical.replace("&sign=fresh-fixture", "");
  const state = fixture({ links: [clean.replace(accountId, "ACI89635771994629725"), unsigned] });
  let opened = 0;
  const result = await resolveRewrittenFootprintPage({ ...state, seed, openHistoryLink: async (_page, card, boundSeed) => {
    opened += 1;
    assert.equal(card.index, 1);
    assert.equal(card.url, unsigned);
    assert.equal(boundSeed.modelPage, base.replace("FixtureCaseSensitive", "AccountCanonical"));
    return canonical;
  } });
  assert.equal(result.url, canonical);
  assert.equal(result.canonicalModelPage, base.replace("FixtureCaseSensitive", "AccountCanonical"));
  assert.equal(opened, 1);
});

test("an opened history item still requires its bound path, full ID and signature", async () => {
  for (const url of [clean.replace("fresh-fixture", ""), clean.replace("FixtureCaseSensitive", "unselected"),
    clean.replace(accountId, "ACI89635771994629725")]) {
    const state = fixture({ links: [clean.replace("&sign=fresh-fixture", "")] });
    await assert.rejects(resolveRewrittenFootprintPage({ ...state, seed, openHistoryLink: async () => url }));
  }
});

test("the browser can return a canonical path obtained from a verified HTTP redirect, still requiring the full ID and sign", async () => {
  const canonical = clean.replace("FixtureCaseSensitive", "ServerCanonical");
  const state = fixture({ links: [seed.url] });
  const result = await resolveRewrittenFootprintPage({ ...state, seed, openHistoryLink: async () => ({
    url: canonical, canonicalModelPage: base.replace("FixtureCaseSensitive", "ServerCanonical"),
  }) });
  assert.equal(result.url, canonical);
  assert.equal(result.canonicalModelPage, base.replace("FixtureCaseSensitive", "ServerCanonical"));
  for (const url of [canonical.replace(accountId, accountId + "99"), canonical.replace("&sign=fresh-fixture", ""),
    canonical.replace("https:", "http:"), canonical.replace("3d.3d66.com", "evil.test")]) {
    await assert.rejects(resolveRewrittenFootprintPage({ ...fixture({ links: [seed.url] }), seed,
      openHistoryLink: async () => ({ url, canonicalModelPage: base.replace("FixtureCaseSensitive", "ServerCanonical") }) }));
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
    assert.equal(error.details.operation, "seed_navigation");
    assert.equal(isSwitchable3D66Error(error), false);
    assert.equal(shouldDegrade3D66Cookie(error), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("history diagnostics identify the failing step without leaking URLs, cookies or raw errors", async () => {
  for (const operation of ["browser_context", "history_read", "history_card_open", "session_save"]) {
    const state = fixture({ links: operation === "history_card_open" ? [seed.url] : [clean] });
    const privateError = Object.assign(new Error("page.goto: net::ERR_CONNECTION_RESET https://private.test/?sign=private-sign cookie=private-cookie"),
      { details: { requestedUrl: "private-url" } });
    const resolver = create3D66RewrittenFootprintResolver({ ...state,
      navigate: async (page, url) => {
        if (operation === "history_read" && url === historyUrl) throw privateError;
        return state.navigate(page, url);
      },
      openHistoryLink: async () => { throw privateError; },
      serializeCookies: () => "fixture",
      withBrowserContext: async (_url, _cookie, callback) => {
        if (operation === "browser_context") throw privateError;
        return callback({ page: state.page, context: { cookies: async () => {
          if (operation === "session_save") throw privateError;
          return [];
        } } });
      },
    });
    await assert.rejects(resolver(source, "private-cookie"), error => {
      assert.deepEqual(error.details, { stage: "rewritten-footprint", reason: "history_operation_interrupted",
        operation, failure: "network", networkCode: "ERR_CONNECTION_RESET" });
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify({ message: error.message, ...error }), /private-/);
      return true;
    });
  }
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
