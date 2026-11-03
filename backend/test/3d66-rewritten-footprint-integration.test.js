import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { fetch3D66Preview, fetchFrom3D66 } from "../src/utils/3d66Service.js";
import { close3D66Browser, download3D66WithBrowser, inspect3D66DownloadFormatsWithBrowser,
  open3D66RewrittenFootprintCard, resume3D66Verification, get3D66VerificationConfigurationKey } from "../src/utils/3d66BrowserService.js";
import { build3D66FootprintSeed } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { threed66VerificationStore } from "../src/utils/3d66VerificationStore.js";

const inputId = "GCI139810814629725";
const cookie = "PHPSESSID=fixture; login_sign=fixture";
let sequence = 0;

async function fixture(t, options = {}) {
  const env = { THREED66_MOCK: "false", THREED66_MODEL_RESOLVE_MODE: "rewritten_footprint",
    THREED66_REQUIRED_ACCOUNT_MARKER: "89635771", THREED66_PROXY_ENABLED: "false",
    THREED66_BROWSER_ALWAYS: "false", THREED66_BROWSER_PROFILE_DIR: "", THREED66_FOOTPRINT_REFRESH_ATTEMPTS: "1",
    THREED66_PROXY_FOR_BROWSER: "false", THREED66_PROXY_URL: "",
    THREED66_DISABLE_BROWSER_PAGE_FALLBACK: "true", THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK: "true",
    THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK: "false" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  await close3D66Browser();
  t.after(async () => {
    await close3D66Browser();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const base = `https://3d.3d66.com/reshtmla/model/items/fixture/rewritten-${++sequence}.html`;
  const source = `${base}?sof=${options.inputId || inputId}&sign=old-sign&r_id=old-owner`;
  const seed = () => build3D66FootprintSeed(source);
  const clean = () => `${base}?sof=${seed().productId}&st=2&sign=history-fixture`;
  const navigations = [];
  const requests = [];
  const pages = [];
  let closedContexts = 0;
  let browserContexts = 0;
  let cookieSeeds = 0;
  const contextOptions = [];
  let formatReady = !options.delayedFormats;
  t.mock.method(chromium, "launch", async () => ({
    on() {}, isConnected: () => true, async close() {},
    async newContext(config) {
      browserContexts += 1;
      contextOptions.push(config);
      let current;
      return {
        async route() {}, async unroute() {}, async addCookies() { cookieSeeds++; }, async cookies() { return []; },
        pages: () => pages,
        async close() { closedContexts += 1; },
        async newPage() {
          const popup = { url: () => clean(), async title() { return "滑动验证页面"; },
            async waitForLoadState() {}, async waitForURL() {} };
          const page = {
            frames: () => [{ url: () => current, async evaluate() { return []; } }],
            async goto(url) {
              current = new URL(url).searchParams.has("sign") && options.browserRedirect ? options.browserRedirect(url) : url;
              navigations.push(url);
            }, url: () => current,
            async title() { return options.challenge?.(current) ? "滑动验证页面" : "Fixture model"; },
            async waitForLoadState() {}, async waitForTimeout() {},
            async waitForSelector() {}, async waitForFunction() { formatReady = true; },
            async content() { return options.html || "<title>Fixture</title>"; },
            async waitForEvent() {
              if (!options.popupChallenge) throw new Error("No fixture popup");
              pages.push(popup);
              return popup;
            },
            waitForURL() { return options.popupChallenge ? new Promise(() => {}) : Promise.reject(new Error("No signed fixture page")); },
            async evaluate(read) {
              if (read.name === "evaluateFormatOptions") return formatReady ? options.inlineFormats || [] : [];
              const id = new URL(current).searchParams.get("sof");
              return { productId: id, title: "Fixture", creditCost: 28, dynamicFields: { llId: id } };
            },
            locator() { return {
              first: () => ({ async waitFor() {} }),
              nth: () => ({ async evaluate(read) { return read({ href: clean().replace("&sign=history-fixture", "") }); }, async click() {} }),
              async evaluateAll(read) { return read((options.links?.(clean()) ?? [clean()]).map((href) => ({ href }))); },
            }; },
          };
          pages.push(page);
          return page;
        },
      };
    },
  }));
  t.mock.method(globalThis, "fetch", async (input, request) => {
    const url = new URL(input);
    requests.push(url.pathname);
    assert.ok(request.headers.cookie.startsWith("PHPSESSID=fixture"));
    assert.equal(new URL(request.headers.referer).origin, "https://3d.3d66.com");
    if (url.pathname === "/api/v1/download/pop") {
      assert.equal(request.body.get("sof"), seed().productId);
      return Response.json({ status: 200, data: { token: "fixture-token", is_direct_download: 1,
        resInfo: { sof: seed().productId, res_name: "Fixture", res_price: 28, res_type: "1",
          img: "https://respic.3d66.com/fixture.jpg" } } });
    }
    if (url.pathname === "/api/v1/download/handle") {
      assert.equal(request.body.get("ll_id"), seed().productId);
      const resUrl = new URL(request.body.get("resUrl"));
      assert.equal(resUrl.searchParams.get("sign"), "history-fixture");
      assert.equal(resUrl.hash, "");
      return Response.json({ status: 200, data: { fileUrl: "https://download.3d66.com/fixture.zip?auth_key=fixture" } });
    }
    assert.fail(`Unexpected upstream HTTP request: ${url.origin}${url.pathname}`);
  });
  return { source, base, seed, clean, navigations, requests, pages,
    contexts: () => browserContexts, closed: () => closedContexts, cookieSeeds: () => cookieSeeds, contextOptions };
}

test("ordinary Direct previews keep one native browser session without re-seeding old cookies", async t => {
  const state = await fixture(t);
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  process.env.THREED66_BROWSER_ALWAYS = "true";
  for (let attempt = 0; attempt < 3; attempt++) await fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true });
  assert.equal(state.contexts(), 1);
  assert.equal(state.closed(), 0);
  assert.equal(state.pages.length, 1);
  assert.equal(state.cookieSeeds(), 1);
  assert.equal("userAgent" in state.contextOptions[0], false);
  assert.equal(state.requests.some(path => path.endsWith("/handle")), false);
});

test("an unreadable durable profile never triggers a proxy switch or a fresh cookie-only context", async t => {
  const state = await fixture(t);
  Object.assign(process.env, { THREED66_MODEL_RESOLVE_MODE: "direct", THREED66_BROWSER_ALWAYS: "true",
    THREED66_BROWSER_PROFILE_DIR: path.join(os.tmpdir(), "profile-fixture-no-io"),
    THREED66_PROXY_ENABLED: "true", THREED66_PROXY_FOR_BROWSER: "true", THREED66_PROXY_URL: "http://127.0.0.1:3128" });
  const directories = t.mock.method(fs, "mkdir", async () => { throw Object.assign(new Error("fixture access denied"), { code: "EACCES" }); });
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { code: "THREED66_PROFILE_LOAD_FAILED" });
  assert.equal(directories.mock.callCount(), 1);
  assert.equal(state.contexts(), 0);
  assert.equal(state.navigations.length, 0);
});

test("verification in a history popup hands off that popup, not the history tab", async t => {
  const state = await fixture(t, { popupChallenge: true, links: url => [url.replace("&sign=history-fixture", "")] });
  await assert.rejects(fetch3D66Preview(state.source, cookie), { status: 403 });
  const [pending] = await threed66VerificationStore.list();
  const entry = threed66VerificationStore.get(pending.id);
  assert.equal(entry.page, state.pages[1]);
  assert.notEqual(entry.page, state.pages[0]);
  assert.equal(entry.initialUrl, state.clean());
  assert.equal(state.closed(), 0);
  assert.deepEqual(state.requests, []);
});

test("browser inspection returns inline options without clicking download or payment", async (t) => {
  const inlineFormats = [{ key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4", isDefault: true },
    { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3", isDefault: false }];
  const state = await fixture(t, { inlineFormats });
  const result = await inspect3D66DownloadFormatsWithBrowser(state.clean(), cookie);
  assert.deepEqual(result.formatOptions, inlineFormats);
  assert.equal(result.metadata.selectedFormat.key, inlineFormats[0].key);
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.navigations, [state.clean()]);
});

test("direct preview waits for delayed DOM choices and merges them even when HTML metadata has an empty list", async (t) => {
  const inlineFormats = [{ key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4", isDefault: true },
    { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3", isDefault: false }];
  const state = await fixture(t, { inlineFormats, delayedFormats: true });
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  process.env.THREED66_BROWSER_ALWAYS = "true";
  const result = await fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true });
  assert.deepEqual(result.formatOptions, inlineFormats);
  assert.equal(result.selectedFormat.key, inlineFormats[0].key);
  assert.deepEqual(state.navigations, [state.clean()]);
  assert.equal(state.requests.some((path) => path.endsWith("/handle")), false);
});

test("direct preview rejects a verification page instead of accepting an empty list backed by pop metadata", async (t) => {
  const state = await fixture(t, { challenge: () => true });
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  process.env.THREED66_BROWSER_ALWAYS = "true";
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 403 });
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
  assert.equal(state.closed(), 0);
  const [pending] = await threed66VerificationStore.list();
  const entry = threed66VerificationStore.get(pending.id);
  assert.equal(entry.page, state.pages[0]);
  assert.equal(entry.seed.mode, "direct");
  assert.equal(entry.seed.modelPage, state.base);
  assert.equal(entry.initialUrl, state.clean());
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 423 });
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
});

test("Direct resumes the exact retained model page without visiting history or reloading it", async t => {
  let blocked = true;
  const inlineFormats = [{ key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4", isDefault: true },
    { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3", isDefault: false }];
  const state = await fixture(t, { challenge: () => blocked, inlineFormats });
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  process.env.THREED66_BROWSER_ALWAYS = "true";
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 403 });
  const [pending] = await threed66VerificationStore.list();
  const entry = threed66VerificationStore.get(pending.id);
  // Simulate the human's completed fixture; this never solves a real challenge.
  blocked = false;
  const result = await resume3D66Verification(entry);
  assert.equal(result.usedFootprint, false);
  assert.equal(result.url, state.clean());
  await threed66VerificationStore.verified(entry, cookie);
  const preview = await fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true });
  assert.deepEqual(preview.formatOptions, inlineFormats);
  assert.equal(state.contexts(), 1);
  assert.equal(entry.page, state.pages[0]);
  assert.deepEqual(state.navigations, [state.clean()]);
  assert.equal(state.requests.some(path => path.endsWith("/handle")), false);
  blocked = true;
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 403 });
  assert.equal((await threed66VerificationStore.list())[0].id, pending.id);
  assert.equal(entry.page, state.pages[0]);
  assert.equal(state.contexts(), 1);
  assert.equal(state.closed(), 0);
});

test("Direct does not retain another model or another path and mode changes invalidate the pending session", async t => {
  for (const redirect of [url => url.replace("?sof=", "-different?sof="), url => url.replace("&st=2", "99&st=2")]) {
    const state = await fixture(t, { challenge: () => true, browserRedirect: redirect });
    process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
    process.env.THREED66_BROWSER_ALWAYS = "true";
    await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 403 });
    assert.deepEqual(await threed66VerificationStore.list(), []);
    assert.equal(state.closed(), 1);
  }
  const state = await fixture(t, { challenge: () => true });
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  process.env.THREED66_BROWSER_ALWAYS = "true";
  await assert.rejects(fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true }), { status: 403 });
  process.env.THREED66_MODEL_RESOLVE_MODE = "rewritten_footprint";
  await threed66VerificationStore.assertAvailable(cookie, get3D66VerificationConfigurationKey());
  assert.deepEqual(await threed66VerificationStore.list(), []);
  assert.equal(state.closed(), 1);
});

for (const stage of ["seed", "history"]) {
  test(`${stage} verification retains the actual failed page, blocks new tasks and resumes only that context`, async t => {
    let blocked = true;
    const state = await fixture(t, { challenge: url => blocked && (stage === "seed"
      ? url?.includes("/model/items/") : url?.includes("/footprint")) });
    process.env.THREED66_BROWSER_MAX_TASKS = "1";
    t.after(() => { delete process.env.THREED66_BROWSER_MAX_TASKS; });
    await assert.rejects(fetch3D66Preview(state.source, cookie), { status: 403 });
    assert.equal(state.contexts(), 1);
    assert.equal(state.closed(), 0);
    const [pending] = await threed66VerificationStore.list();
    assert.ok(pending);
    const entry = threed66VerificationStore.get(pending.id);
    assert.equal(entry.page, state.pages[0]);
    await assert.rejects(fetch3D66Preview(state.source, cookie), { status: 423 });
    assert.equal(state.contexts(), 1);
    assert.deepEqual(state.requests, []);
    // This fixture changes state directly; no real verification is ever solved by the test.
    blocked = false;
    await threed66VerificationStore.verified(entry, cookie);
    await fetch3D66Preview(state.source, cookie);
    assert.equal(state.contexts(), 1);
    await close3D66Browser();
    assert.equal(state.closed(), 1);
    assert.deepEqual(await threed66VerificationStore.list(), []);
  });
}

test("preview and download use only the exact signed history URL and retain original logical identity", async (t) => {
  const state = await fixture(t);
  const preview = await fetch3D66Preview(state.source, cookie);
  assert.equal(preview.productId, inputId);
  assert.equal(preview.sourceUrl, state.source);
  assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sof"), state.seed().productId);
  const download = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
  assert.equal(download.productId, inputId);
  assert.equal(download.sourceUrl, state.source);
  assert.equal(new URL(download.resolvedSourceUrl).searchParams.get("sign"), "history-fixture");
  assert.ok(download.fileUrl.startsWith("https://download.3d66.com/"));
  assert.equal(state.contexts(), 1);
  assert.deepEqual(state.navigations, [state.seed().url, "https://user.3d66.com/newUser/index/index/footprint"]);
  assert.equal(state.requests.filter((value) => value === "/api/v1/download/handle").length, 1);
});

test("a short public ID is expanded before navigation and preview/download share the st=2 cache", async (t) => {
  const state = await fixture(t, { inputId: "AJI7972535" });
  const preview = await fetch3D66Preview(state.source, cookie);
  const download = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
  assert.equal(preview.productId, "AJI7972535");
  assert.equal(download.productId, "AJI7972535");
  assert.equal(state.navigations[0], `${state.base}?sof=AJI896357717972535&st=2`);
  assert.equal(new URL(download.resolvedSourceUrl).searchParams.get("sof"), "AJI896357717972535");
  assert.ok(!state.navigations.includes(state.source));
  assert.equal(state.contexts(), 1);
});

test("cache cannot be reused across cookies or configured required markers", async (t) => {
  const state = await fixture(t);
  await fetch3D66Preview(state.source, cookie);
  await fetch3D66Preview(state.source + "&tracking=another", cookie);
  assert.equal(state.contexts(), 1);
  await fetch3D66Preview(state.source, cookie + "; other=fixture");
  assert.equal(state.contexts(), 2);
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "12345678";
  await fetch3D66Preview(state.source, cookie);
  assert.equal(state.contexts(), 3);
});

test("a resolved history URL retains its original eight-digit source identity with a longer target marker", async (t) => {
  const state = await fixture(t);
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "123456789";
  const preview = await fetch3D66Preview(state.source, cookie);
  const result = await fetchFrom3D66(preview.resolvedSourceUrl, cookie);
  assert.equal(result.productId, inputId);
  assert.equal(new URL(result.resolvedSourceUrl).searchParams.get("sof"), "ACI1234567894629725");
  assert.equal(state.contexts(), 1);
});

for (const [label, links] of [["missing history", () => []],
  ["wrong ID with shared suffix", (clean) => [clean.replace("ACI89635771", "ACI8963577199")]],
  ["unsigned history", (clean) => [clean.replace("&sign=history-fixture", "")]]]) {
  test(`${label} stops before preview or purchase APIs, without search fallback`, async (t) => {
    const state = await fixture(t, { links });
    for (const execute of [fetch3D66Preview, fetchFrom3D66]) {
      await assert.rejects(execute(state.source, cookie));
    }
    assert.equal(state.contexts(), 2);
    assert.deepEqual(state.requests, []);
    assert.ok(!state.navigations.includes(state.source));
  });
}

test("an account-specific canonical history URL is cached through preview and download without reopening the old path", async (t) => {
  const state = await fixture(t, { links: (url) => [url.replace(".html", "-canonical.html")] });
  const preview = await fetch3D66Preview(state.source, cookie);
  assert.equal(new URL(preview.resolvedSourceUrl).pathname, new URL(state.base).pathname.replace(".html", "-canonical.html"));
  const result = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
  assert.equal(result.sourceUrl, state.source);
  assert.equal(new URL(result.resolvedSourceUrl).pathname, new URL(preview.resolvedSourceUrl).pathname);
  assert.equal(state.contexts(), 1);
});

test("ID-only and ambiguous source inputs fail before creating a browser context", async (t) => {
  const state = await fixture(t);
  for (const value of [state.source + "&sof=" + inputId,
    `https://3d.3d66.com/reshtmla/model/items/id/model.html?sof=${inputId}`]) {
    await assert.rejects(fetchFrom3D66(value, cookie), { code: "THREED66_REWRITTEN_FOOTPRINT_FAILED", status: 400 });
  }
  assert.equal(state.contexts(), 0);
  assert.deepEqual(state.requests, []);
});

for (const [name, browserRedirect] of [["another path", (url) => url.replace(".html", "-other.html")],
  ["another ID sharing the suffix", (url) => url.replace("ACI89635771", "ACI8963577199")]]) {
  test(`browser fallback blocks ${name} before any download/format/payment click`, async (t) => {
    const state = await fixture(t, { browserRedirect });
    for (const execute of [download3D66WithBrowser, inspect3D66DownloadFormatsWithBrowser]) {
      await assert.rejects(execute(state.clean(), cookie, { rewrittenFootprintSeed: state.seed() }),
        { code: "THREED66_REWRITTEN_FOOTPRINT_FAILED" });
    }
    assert.deepEqual(state.requests, []);
  });
}

function openedCardFixture({ navigation = "", downloadRequest = false, changedHref = false, challenge = false } = {}) {
  const seed = build3D66FootprintSeed("https://3d.3d66.com/reshtmla/model/items/fixture/canonical.html?sof=GCI139810814629725");
  const unsigned = `${seed.modelPage}?sof=${seed.productId}&st=2`;
  const signed = unsigned + "&sign=real-history-fixture";
  const actions = [];
  let guard;
  const opened = { url: () => signed, async waitForLoadState() {},
    async title() { return challenge ? "滑动验证页面" : "Fixture model"; },
    async waitForURL(predicate) { assert.equal(predicate(new URL(signed)), true); } };
  const context = {
    async route(_pattern, callback) { guard = callback; },
    async unroute(_pattern, callback) { assert.equal(callback, guard); actions.push("unroute"); },
  };
  const page = {
    locator() { return { nth(index) {
      assert.equal(index, 2);
      return {
        async evaluate(read) { return read({ href: changedHref ? signed : unsigned }); },
        async click(options) {
          actions.push("pointer-click");
          assert.equal(options.noWaitAfter, true);
          if (navigation || downloadRequest) {
            await guard({ request: () => ({ url: () => navigation || "https://user.3d66.com/api/v1/download/handle",
              isNavigationRequest: () => Boolean(navigation) }), async abort() { actions.push("blocked"); },
            async fallback() { actions.push("network"); } });
          }
        },
      };
    } }; },
    async waitForEvent(event) { assert.equal(event, "popup"); return opened; },
    waitForURL() { return new Promise(() => {}); },
  };
  return { page, context, seed, card: { url: unsigned, index: 2 }, signed, actions };
}

test("history opening uses a physical pointer click and never calls the purchase API", async () => {
  const state = openedCardFixture({ downloadRequest: true });
  assert.equal(await open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context), state.signed);
  assert.deepEqual(state.actions, ["pointer-click", "blocked", "unroute"]);
});

test("a history card changed before the click is rejected without navigation", async () => {
  const state = openedCardFixture({ changedHref: true });
  await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
    (error) => error.details.reason === "history_card_changed");
  assert.deepEqual(state.actions, []);
});

test("a verification page opened from history returns an actionable terminal error without accepting its URL", async () => {
  const state = openedCardFixture({ challenge: true });
  await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
    (error) => error.status === 403 && error.details.reason === "upstream_verification_required");
  assert.deepEqual(state.actions, ["pointer-click", "unroute"]);
});

test("unexpected model navigation is blocked before reaching the network", async () => {
  const state = openedCardFixture({ navigation: "https://3d.3d66.com/reshtmla/model/items/fixture/other.html?sof=ACI896357714629725&sign=fixture" });
  await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
    (error) => error.details.reason === "opened_model_mismatch");
  assert.deepEqual(state.actions, ["pointer-click", "blocked", "unroute"]);
});
