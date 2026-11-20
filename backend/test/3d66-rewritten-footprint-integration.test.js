import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import ProductCache from "../src/models/ProductCache.js";
import { fetch3D66Preview, fetchFrom3D66, request3D66File, inspect3D66DownloadChoice } from "../src/utils/3d66Service.js";
import { read3D66CadVerification } from "../src/utils/3d66CadProof.js";
import { assert3D66StoredDownload } from "../src/utils/3d66CleanLink.js";
import { close3D66Browser, download3D66WithBrowser, inspect3D66DownloadFormatsWithBrowser,
  open3D66RewrittenFootprintCard, resume3D66Verification, get3D66VerificationConfigurationKey } from "../src/utils/3d66BrowserService.js";
import { build3D66FootprintSeed } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { threed66VerificationStore } from "../src/utils/3d66VerificationStore.js";

const inputId = "GCI139810814629725";
const cookie = "PHPSESSID=fixture; login_sign=fixture";
let sequence = 0;

async function fixture(t, options = {}) {
  const env = { THREED66_MOCK: "false", THREED66_MODEL_RESOLVE_MODE: options.mode || "rewritten_footprint",
    THREED66_REQUIRED_ACCOUNT_MARKER: "89635771", THREED66_PROXY_ENABLED: "false",
    THREED66_BROWSER_ALWAYS: "false", THREED66_BROWSER_PROFILE_DIR: "", THREED66_FOOTPRINT_REFRESH_ATTEMPTS: "1",
    THREED66_PROXY_FOR_BROWSER: "false", THREED66_PROXY_URL: "",
    THREED66_DISABLE_BROWSER_PAGE_FALLBACK: "true", THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK: "true",
    THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK: "false",
    ...(options.popEndpoint ? { THREED66_DOWNLOAD_POP_ENDPOINT: options.popEndpoint } : {}) };
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
  const origin = options.origin || (options.sketchup ? "https://su.3d66.com" : "https://3d.3d66.com");
  const resource = options.resource || (options.sketchup ? "sketchup" : "model");
  const base = `${origin}/${options.itemPath || `reshtmla/${resource}/items/fixture`}/rewritten-${++sequence}.html`;
  const source = `${base}?sof=${options.inputId || inputId}&sign=old-sign&r_id=old-owner`;
  const seed = () => build3D66FootprintSeed(source);
  const cleanId = () => options.cleanId || (options.historyPrefix ? options.historyPrefix + seed().productId.slice(1) : seed().productId);
  const clean = () => `${base}?sof=${cleanId()}&st=2${options.cadUnsigned ? "" : "&sign=history-fixture"}`;
  t.mock.method(ProductCache, "find", filter => {
    assert.deepEqual(filter, { productId: { $in: seed().legacyIds } });
    const query = {
      select(fields) {
        assert.equal(fields, "productId resolvedSourceUrl");
        return this;
      },
      limit(count) { assert.equal(count, seed().legacyIds.length); return this; },
      maxTimeMS() { return this; },
      async lean() { return options.cachedLinks?.(clean(), seed()) || []; },
    };
    return query;
  });
  const navigations = [];
  const requests = [];
  const payloads = [];
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
      let storedCookies = config.storageState?.cookies || [];
      const cadDoc = () => ({ pageUrl: clean(), code: 200, productId: cleanId(), publicAssetId: 21681188,
        resourceType: 8, deleted: 0, sourceAccountId: 177536980, originUrl: clean(), price: 28,
        fileFormat: 8, formatVersion: "2014", suffix: "DWG", ...options.cadDocument });
      const apiResponse = data => ({ ok: () => true, status: () => 200,
        async body() { return Buffer.from(JSON.stringify(data)); }, async dispose() {} });
      return {
        async route() {}, async unroute() {},
        async addCookies(cookies) {
          cookieSeeds++;
          storedCookies = cookies.map(c => ({ ...c, domain: c.domain || new URL(c.url).hostname, path: c.path || "/" }));
        }, async cookies() { return storedCookies; },
        request: {
          async get(endpoint) {
            assert.equal(endpoint, "https://user.3d66.com/new-user-api/api/v1/user/info");
            return apiResponse({ code: 200, data: { basic: { user_id: options.cadAccountId || 177536980 } } });
          },
          async post(endpoint, req) {
            assert.equal(endpoint, "https://user.3d66.com/api/v1/download/pop");
            assert.deepEqual(req.form, { sof: cleanId(), res_type: "8" });
            return apiResponse({ status: 200, data: { token: "cad-fixture-token", is_direct_download: 1,
              resInfo: { sof: cleanId(), res_name: "Fixture CAD", img: "https://respic.3d66.com/cad.jpg",
                res_type: 8, is_delete: 0, res_price: 28 } } });
          },
        },
        pages: () => pages,
        async close() { closedContexts += 1; },
        async newPage() {
          const popup = { url: () => clean(), async title() { return options.cadUnsigned ? "Fixture CAD" : "滑动验证页面"; },
            frames: () => [], async close() { const i = pages.indexOf(popup); if (i >= 0) pages.splice(i, 1); },
            async evaluate(read) {
              if (read.name === "read3D66CadDocument") return cadDoc();
              if (read.name === "evaluateFormatOptions") return [];
              return { productId: cleanId(), title: "Fixture CAD", creditCost: 28, priceKnown: true,
                found: { detailData: true }, dynamicFields: { llId: cleanId() } };
            }, async waitForFunction() {}, async waitForLoadState() {}, async waitForURL() {} };
          const page = {
            frames: () => [{ url: () => current, async evaluate() { return []; } }],
            async goto(url) {
              current = new URL(url).searchParams.has("sign") && options.browserRedirect ? options.browserRedirect(url) : url;
              navigations.push(url);
              if (url === seed().url && options.seedHome) {
                current = options.seedHome;
                if (options.seedInterrupted) throw new Error("page.goto: net::ERR_ABORTED");
              }
            }, url: () => current,
            async title() { return options.challenge?.(current) ? "滑动验证页面" : "Fixture model"; },
            async waitForLoadState() {}, async waitForTimeout() {},
            async waitForSelector() {}, async waitForFunction() { formatReady = true; },
            async content() { return options.html || "<title>Fixture</title>"; },
            async waitForEvent() {
              if (!options.popupChallenge && !options.cadUnsigned) throw new Error("No fixture popup");
              pages.push(popup);
              return popup;
            },
            waitForURL() { return options.popupChallenge ? new Promise(() => {}) : Promise.reject(new Error("No signed fixture page")); },
            async evaluate(read) {
              if (read.name === "evaluateFormatOptions") return formatReady ? options.inlineFormats || [] : [];
              const id = new URL(current).searchParams.get("sof");
              return { productId: id, detailProductId: options.cachedPageId?.(current, id) ?? id,
                title: "Fixture", creditCost: 28, dynamicFields: { llId: id } };
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
    if (options.cadUnsigned && url.hostname === "download.3d66.com") {
      assert.equal(String(request.headers.referer).includes("cad_verified"), false);
      assert.equal(String(request.headers.referer).includes("cad1."), false);
      return new Response("fixture bytes", { headers: { "content-type": "application/octet-stream" } });
    }
    assert.ok(request.headers.cookie.startsWith("PHPSESSID=fixture"));
    assert.equal(new URL(request.headers.referer).origin, origin);
    payloads.push({ path: url.pathname, body: new URLSearchParams(request.body), origin: request.headers.origin });
    if (url.pathname === "/api/v1/download/pop") {
      if (options.popResponse) return options.popResponse();
      const requestedId = request.body.get("sof");
      if (options.mode === "hybrid") assert.ok([options.inputId || inputId, cleanId()].includes(requestedId));
      else assert.equal(requestedId, cleanId());
      return Response.json({ status: 200, data: { token: "fixture-token", is_direct_download: 1,
        format_list: options.popFormats,
        resInfo: { sof: requestedId, res_name: "Fixture", res_price: options.cadLivePrice || 28, is_delete: 0,
          res_type: options.site || (options.sketchup ? "6" : "1"),
          img: "https://respic.3d66.com/fixture.jpg" }, ...options.popData?.(clean(), requestedId) } });
    }
    if (url.pathname === "/api/v1/download/handle") {
      assert.equal(request.body.get("ll_id"), cleanId());
      const resUrl = new URL(request.body.get("resUrl"));
      assert.equal(resUrl.searchParams.get("sign"), options.cadUnsigned ? null : "history-fixture");
      assert.equal(resUrl.hash, "");
      assert.equal(request.body.toString().includes("cad1."), false);
      return Response.json({ status: 200, data: { fileUrl: "https://download.3d66.com/fixture.zip?auth_key=fixture" } });
    }
    assert.fail(`Unexpected upstream HTTP request: ${url.origin}${url.pathname}`);
  });
  return { source, base, seed, clean, navigations, requests, payloads, pages,
    contexts: () => browserContexts, closed: () => closedContexts, cookieSeeds: () => cookieSeeds, contextOptions };
}

test("SketchUp rewritten preview and mock download reuse a signed history URL with SU API context", async t => {
  const state = await fixture(t, { sketchup: true, inputId: "JJI139810814629725", seedHome: "https://su.3d66.com/" });
  const before = process.env.THREED66_ORIGIN;
  process.env.THREED66_ORIGIN = "https://3d.3d66.com";
  t.after(() => {
    if (before === undefined) delete process.env.THREED66_ORIGIN;
    else process.env.THREED66_ORIGIN = before;
  });
  const mixedCookie = cookie + "; resUrlreferrer=" + encodeURIComponent(JSON.stringify({ site: "1", access_source_site: "1" }));
  const preview = await fetch3D66Preview(state.source, mixedCookie);
  assert.equal(new URL(preview.resolvedSourceUrl).origin, "https://su.3d66.com");
  assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sof"), "AJI896357714629725");
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
  assert.equal(state.payloads[0].body.get("res_type"), "6");
  const result = await fetchFrom3D66(preview.resolvedSourceUrl, mixedCookie, { sourceUrl: state.source });
  assert.ok(result.fileUrl.startsWith("https://download.3d66.com/fixture.zip"));
  const handle = state.payloads.find(item => item.path.endsWith("/handle"));
  assert.equal(handle.origin, "https://su.3d66.com");
  assert.equal(handle.body.get("site"), "6");
  assert.equal(handle.body.get("access_source_site"), "6");
  assert.equal(handle.body.has("format_version"), false);
  assert.equal(handle.body.has("renderer_type"), false);
  assert.deepEqual(state.navigations, [state.seed().url, "https://user.3d66.com/newUser/index/index/footprint"]);
  assert.equal(state.contexts(), 1);
  assert.equal(state.requests.filter(url => url.endsWith("/handle")).length, 1);
});

for (const [host, resource, site, itemPath] of [["su", "sketchup", "6"], ["cad", "cad", "8"],
  ["tietu", "tietu", "5"], ["fanganwenben", "fanganwenben", "12"],
  ["xiaoguotu", "", "10", "imghtml/items/fixture"]]) {
  test(`${host} uses source-first history and its own API site without Max defaults`, async t => {
    const origin = `https://${host}.3d66.com`;
    const state = await fixture(t, { origin, resource, site, itemPath, seedHome: origin + "/" });
    const preview = await fetch3D66Preview(state.source, cookie);
    assert.deepEqual(state.navigations, [state.source, "https://user.3d66.com/newUser/index/index/footprint"]);
    assert.equal(new URL(preview.resolvedSourceUrl).origin, origin);
    assert.equal(state.payloads[0].body.get("res_type"), site);
    await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
    const handle = state.payloads.find(item => item.path.endsWith("/handle"));
    assert.equal(handle.origin, origin);
    assert.equal(handle.body.get("site"), site);
    assert.equal(handle.body.has("renderer_type"), false);
    assert.equal(handle.body.has("format_version"), false);
    assert.equal(state.contexts(), 1);
    assert.equal(state.navigations.some(url => new URL(url).searchParams.get("st") === "2"), false);
  });
}

test("source-first history preserves the source account prefix through cache and mock download", async t => {
  const state = await fixture(t, { sketchup: true, historyPrefix: "J" });
  const first = await fetch3D66Preview(state.source, cookie);
  const second = await fetch3D66Preview(state.source, cookie);
  assert.equal(first.resolvedSourceUrl, second.resolvedSourceUrl);
  assert.equal(new URL(first.resolvedSourceUrl).searchParams.get("sof"), "JCI896357714629725");
  await fetchFrom3D66(first.resolvedSourceUrl, cookie, { sourceUrl: state.source });
  assert.equal(state.contexts(), 1);
  assert.equal(state.payloads.find(item => item.path.endsWith("/handle")).body.get("ll_id"), "JCI896357714629725");
});

for (const mode of ["footprint", "rewritten_footprint", "hybrid"]) {
  test(`unsigned CAD ${mode} verifies source evidence and keeps proof private through a mock purchase and stream`, async t => {
    const state = await fixture(t, { mode, cadUnsigned: true, origin: "https://cad.3d66.com", resource: "cad", site: "8" });
    const preview = await fetch3D66Preview(state.source, cookie, { includeFormatOptions: true });
    assert.equal(preview.priceKnown, true);
    assert.equal(preview.creditCost, 28);
    assert.equal(preview.formatOptions.length, 1);
    assert.equal(preview.formatOptions[0].fileFormat, "8");
    assert.equal(preview.formatOptions[0].rendererType, "");
    assert.equal(preview.dynamicFields, undefined);
    assert.equal(new URL(preview.resolvedSourceUrl).searchParams.has("sign"), false);
    assert.ok(read3D66CadVerification(preview.resolvedSourceUrl));
    assert.equal(state.requests.some(value => value.endsWith("/handle")), false);
    const choice = await inspect3D66DownloadChoice(preview.resolvedSourceUrl, cookie);
    assert.equal(choice.hasFormatChoice, false);
    const visits = state.navigations.length;
    const result = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source,
      downloadFormat: preview.selectedFormat, expectedCreditCost: 28 });
    assert.ok(state.navigations.length > visits, "A new CAD purchase re-verifies the loaded source page");
    assert.doesNotThrow(() => assert3D66StoredDownload(result));
    const handle = state.payloads.find(item => item.path.endsWith("/handle"));
    assert.equal(handle.body.get("file_format"), "8");
    assert.equal(handle.body.get("format_version"), "2014");
    assert.equal(handle.body.has("renderer_type"), false);
    const response = await request3D66File(result.fileUrl, cookie, { sourceUrl: result.resolvedSourceUrl });
    assert.equal(await response.text(), "fixture bytes");
    assert.equal(state.requests.filter(path => path.endsWith("/handle")).length, 1);
  });
}

test("unsigned CAD does not invent a format when the source only declares a CAD version", async t => {
  const state = await fixture(t, { cadUnsigned: true, origin: "https://cad.3d66.com", resource: "cad", site: "8",
    cadDocument: { fileFormat: "", formatVersion: "CAD2007", suffix: "", originUrl: undefined } });
  const preview = await fetch3D66Preview(state.source, cookie);
  assert.deepEqual(preview.formatOptions, []);
  assert.equal(preview.selectedFormat, null);
  await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { expectedCreditCost: 28 });
  const payload = state.payloads.find(item => item.path.endsWith("/handle")).body;
  assert.equal(payload.has("file_format"), false);
  assert.equal(payload.has("renderer_type"), false);
  assert.equal(payload.has("format_version"), false);
});

for (const [label, extras, expectedCreditCost] of [
  ["another signed-in account", { cadAccountId: 999999999 }, 28],
  ["another source asset", { cadDocument: { productId: "AJI89635771994629725" } }, 28],
  ["changed API price", { cadLivePrice: 29 }, 28],
  ["changed confirmed price", {}, 27],
]) {
  test(`unsigned CAD rejects ${label} before the purchase API`, async t => {
    const state = await fixture(t, { cadUnsigned: true, origin: "https://cad.3d66.com", resource: "cad", site: "8", ...extras });
    await assert.rejects(fetchFrom3D66(state.source, cookie, { expectedCreditCost }), error => error.code === "THREED66_CLEAN_LINK_REQUIRED");
    assert.equal(state.requests.some(value => value.endsWith("/handle")), false);
  });
}

test("hybrid progressive API metadata is immediate and preparation reuses one context through seed/history/formats", async t => {
  const formats = [{ key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4", isDefault: true },
    { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3" }];
  const state = await fixture(t, { mode: "hybrid", inlineFormats: formats, seedHome: "https://www.3d66.com/", seedInterrupted: true });
  const early = await fetch3D66Preview(state.source, cookie, { progressive: true });
  assert.equal(early.preparationStatus, "pending");
  assert.equal(early.creditCost, 28);
  assert.equal(state.contexts(), 0);
  assert.equal(early.resolvedSourceUrl, undefined);
  const ready = await fetch3D66Preview(state.source, cookie, { includeFormatOptions: true });
  assert.equal(ready.preparationStatus, "ready");
  assert.equal(ready.formatsChecked, true);
  assert.deepEqual(ready.formatOptions, formats);
  assert.equal(new URL(ready.resolvedSourceUrl).searchParams.get("sof"), state.seed().productId);
  assert.equal(state.contexts(), 1);
  assert.equal(state.navigations.includes(state.source), false);
  assert.equal(state.navigations.filter(url => url === state.seed().url).length, 1);
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
  const before = state.navigations.length;
  await fetch3D66Preview(state.source, cookie, { includeFormatOptions: true });
  assert.equal(state.navigations.length, before);
  const download = await fetchFrom3D66(ready.resolvedSourceUrl, cookie, { sourceUrl: state.source });
  assert.equal(download.productId, inputId);
  assert.equal(new URL(download.resolvedSourceUrl).searchParams.get("sof"), state.seed().productId);
  assert.equal(state.contexts(), 1);
  assert.equal(state.requests.filter(url => url.endsWith("/handle")).length, 1);
});

test("hybrid signed-page preparation permits a verified page without a format selector and skips rewriting", async t => {
  const state = await fixture(t, { mode: "hybrid" });
  const ready = await fetch3D66Preview(state.clean(), cookie, { includeFormatOptions: true });
  assert.equal(ready.preparationStatus, "ready");
  assert.equal(ready.formatsChecked, true);
  assert.deepEqual(ready.formatOptions, []);
  assert.deepEqual(state.navigations, [state.clean()]);
});

test("a signed account URL returned by the API with complete choices skips Chromium", async t => {
  const state = await fixture(t, { mode: "hybrid", popData: url => ({ is_choice: 0, model_url: url }) });
  const result = await fetch3D66Preview(state.source, cookie, { includeFormatOptions: true });
  assert.equal(result.preparationStatus, "ready");
  assert.equal(result.resolutionRoute, "api_link");
  assert.equal(state.contexts(), 0);
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
});

test("an API URL with only a matching short suffix cannot bypass full-model verification", async t => {
  const state = await fixture(t, { mode: "hybrid", popData: url => ({ is_choice: 0,
    model_url: url.replace("4629725", "9929725") }) });
  const result = await fetch3D66Preview(state.source, cookie, { includeFormatOptions: true });
  assert.equal(result.resolutionRoute, "rewritten_history");
  assert.equal(state.contexts(), 1);
});

test("hybrid read-only metadata rejects a configured purchase endpoint before any IO", async t => {
  const state = await fixture(t, { mode: "hybrid", popEndpoint: "https://3d.3d66.com/api/v1/download/handle" });
  await assert.rejects(fetch3D66Preview(state.source, cookie, { progressive: true }), {
    code: "THREED66_HYBRID_CONFIGURATION_INVALID",
  });
  assert.deepEqual(state.requests, []);
  assert.equal(state.contexts(), 0);
});

test("an API CAPTCHA stops without browser retries or a purchase request", async t => {
  const state = await fixture(t, { mode: "hybrid", popResponse: () => new Response("<title>访问验证</title>", { status: 403 }) });
  await assert.rejects(fetch3D66Preview(state.source, cookie, { progressive: true }), {
    code: "THREED66_HYBRID_VERIFICATION_REQUIRED", status: 403,
  });
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
  assert.equal(state.contexts(), 0);
});

test("hybrid CAPTCHA retains its exact context and does not restart with another route", async t => {
  const state = await fixture(t, { mode: "hybrid", challenge: url => !new URL(url).searchParams.has("sign") });
  await assert.rejects(fetch3D66Preview(state.source, cookie, { includeFormatOptions: true }), { status: 403 });
  const [pending] = await threed66VerificationStore.list();
  assert.ok(pending);
  const entry = threed66VerificationStore.get(pending.id);
  assert.equal(entry.seed.mode, "hybrid");
  assert.equal(entry.page, state.pages[0]);
  assert.equal(state.contexts(), 1);
  assert.equal(state.closed(), 0);
  assert.deepEqual(state.navigations, [state.seed().url]);
});

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

test("direct preview waits for delayed DOM choices and prefers them to structured HTML and pop metadata", async (t) => {
  const inlineFormats = [{ key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4", isDefault: true },
    { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3", isDefault: false }];
  const generic = [{ file_format: "1", format_version: "2014" }, { file_format: "1", format_version: "max2016" }];
  const html = `<input id="detail_data" value='${JSON.stringify({ res: { down_file_format: generic } })}'>`;
  const state = await fixture(t, { inlineFormats, delayedFormats: true, html, popFormats: generic });
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

for (const mode of ["rewritten_footprint", "hybrid"]) {
  test(`${mode} resolves a six-digit sender and refreshes only the verified model`, async t => {
    const inputId = "DJI1694334859465";
    const cleanId = "AJI896357714859465";
    const state = await fixture(t, { mode, inputId, cleanId, seedHome: "https://www.3d66.com/" });
    const preview = await fetch3D66Preview(state.source, cookie);
    assert.equal(preview.productId, inputId);
    assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sof"), cleanId);
    assert.equal(state.navigations[0], state.source);
    assert.equal(state.navigations.some(value => value.includes("AJI8963577159465")), false);
    assert.equal(state.requests.includes("/api/v1/download/handle"), false);

    const wrongPath = preview.resolvedSourceUrl.replace(state.base, state.base.replace("/fixture/", "/wrong/"));
    assert.throws(() => assert3D66StoredDownload({ ...preview, resolvedSourceUrl: wrongPath }),
      { code: "THREED66_CLEAN_LINK_REQUIRED" });
    const otherInterpretation = preview.resolvedSourceUrl.replace(cleanId, "AJI8963577159465");
    await assert.rejects(fetchFrom3D66(state.source, cookie, { expectedResolvedSourceUrl: otherInterpretation }),
      error => error.code === "THREED66_CLEAN_LINK_REQUIRED" && error.details.reason === "asset_identity_mismatch");
    assert.equal(state.requests.includes("/api/v1/download/handle"), false);
    const download = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
    assert.equal(download.productId, inputId);
    assert3D66StoredDownload(download);
    assert.equal(state.navigations.filter(value => value === state.source).length, 1);
    assert.equal(state.requests.filter(value => value === "/api/v1/download/handle").length, 1);
  });
}

const legacyInputId = "DJI1694334859465";
const legacyCleanId = "AJI896357714859465";
const legacyCandidateId = "AJI8963577159465";
const cachedLegacyModel = url => ({ productId: legacyCleanId, resolvedSourceUrl: url });
const legacyProbeUrl = url => url.replace("sign=history-fixture", "sign=cache-fixture");
const legacyRewriteUrl = state => `${state.base}?sof=${legacyCleanId}&st=2`;
const accountHistoryUrl = "https://user.3d66.com/newUser/index/index/footprint";

for (const mode of ["rewritten_footprint", "hybrid"]) {
  test(`${mode} confirms a six-digit sender model before st=2 and uses the history signature, not the cache signature`, async t => {
    const state = await fixture(t, {
      mode, inputId: legacyInputId, cleanId: legacyCleanId,
      cachedLinks: url => [cachedLegacyModel(legacyProbeUrl(url) + "#resolved=footprint")],
    });
    const preview = await fetch3D66Preview(state.source, cookie);
    assert.equal(preview.productId, legacyInputId);
    assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sof"), legacyCleanId);
    assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sign"), "history-fixture");
    const expected = [legacyProbeUrl(state.clean()), legacyRewriteUrl(state), accountHistoryUrl];
    if (mode === "hybrid") {
      assert.equal(preview.resolutionRoute, "verified_legacy_cache_history");
      expected.push(state.clean());
    }
    assert.deepEqual(state.navigations, expected);
    assert.equal(state.requests.some(path => path.endsWith("/handle")), false);
    assert.equal(state.contexts(), 1);
    const download = await fetchFrom3D66(preview.resolvedSourceUrl, cookie, { sourceUrl: state.source });
    assert.equal(download.productId, legacyInputId);
    assert3D66StoredDownload(download);
    assert.deepEqual(state.navigations, expected);
    assert.equal(state.requests.filter(path => path.endsWith("/handle")).length, 1);
  });
}

test("a verified cached model cannot authorize a preview without its exact signed history card", async t => {
  const state = await fixture(t, {
    inputId: legacyInputId, cleanId: legacyCleanId,
    cachedLinks: url => [cachedLegacyModel(legacyProbeUrl(url))],
    links: url => [url.replace(legacyCleanId, legacyCandidateId)],
  });
  await assert.rejects(fetch3D66Preview(state.source, cookie),
    error => error.details?.reason === "signed_model_not_found_in_history");
  assert.deepEqual(state.navigations, [legacyProbeUrl(state.clean()), legacyRewriteUrl(state), accountHistoryUrl]);
  assert.deepEqual(state.requests, []);
});

test("legacy cache ignores invalid, wrong-path, duplicate or conflicting candidate links", async t => {
  for (const links of [
    url => [cachedLegacyModel(url.replace("/fixture/", "/different/"))],
    url => [cachedLegacyModel(url + "&sign=another")],
    url => [{ productId: legacyCandidateId, resolvedSourceUrl: url }],
    url => [cachedLegacyModel(url), { productId: legacyCandidateId, resolvedSourceUrl: url.replace(legacyCleanId, legacyCandidateId) }],
  ]) {
    await t.test("invalid cache entry", async t => {
      const state = await fixture(t, { inputId: legacyInputId, cleanId: legacyCleanId, links: () => [], cachedLinks: links });
      await assert.rejects(fetch3D66Preview(state.source, cookie),
        error => error.details?.reason === "signed_model_not_found_in_history");
      assert.equal(state.navigations[0], state.source);
      assert.deepEqual(state.requests, []);
    });
  }
});

test("a cached signed URL with the wrong model in source metadata falls back to the original history flow", async t => {
  const state = await fixture(t, {
    inputId: legacyInputId, cleanId: legacyCleanId, cachedLinks: url => [cachedLegacyModel(url)],
    cachedPageId: (_url, id) => id === legacyCleanId ? legacyCandidateId : id,
  });
  const preview = await fetch3D66Preview(state.source, cookie);
  assert.equal(new URL(preview.resolvedSourceUrl).searchParams.get("sof"), legacyCleanId);
  assert.deepEqual(state.navigations, [state.clean(), state.source, "https://user.3d66.com/newUser/index/index/footprint"]);
  assert.equal(state.requests.some(path => path.endsWith("/handle")), false);
});

test("a cached legacy link still honors an upstream verification challenge", async t => {
  let blocked = true;
  const state = await fixture(t, {
    inputId: legacyInputId, cleanId: legacyCleanId, cachedLinks: url => [cachedLegacyModel(legacyProbeUrl(url))],
    challenge: url => blocked && url?.includes("sign=cache-fixture"),
  });
  await assert.rejects(fetch3D66Preview(state.source, cookie),
    error => error.status === 403 && error.details?.reason === "upstream_verification_required");
  assert.deepEqual(state.navigations, [legacyProbeUrl(state.clean())]);
  assert.deepEqual(state.requests, []);
  const [pending] = await threed66VerificationStore.list();
  assert.ok(pending);
  blocked = false;
  const result = await resume3D66Verification(threed66VerificationStore.get(pending.id));
  assert.equal(new URL(result.url).searchParams.get("sign"), "history-fixture");
  assert.deepEqual(state.navigations, [legacyProbeUrl(state.clean()), legacyRewriteUrl(state), accountHistoryUrl, state.clean()]);
  assert.deepEqual(state.requests, []);
});

test("hybrid ignores a mismatched read-only metadata ID and verifies the cached model independently", async t => {
  const state = await fixture(t, {
    mode: "hybrid", inputId: legacyInputId, cleanId: legacyCleanId, cachedLinks: url => [cachedLegacyModel(legacyProbeUrl(url))],
    popData: () => ({ resInfo: { sof: legacyCandidateId, res_name: "Incorrect fixture", res_price: 99 } }),
  });
  const preview = await fetch3D66Preview(state.source, cookie);
  assert.equal(preview.resolutionRoute, "verified_legacy_cache_history");
  assert.equal(preview.title, "Fixture");
  assert.equal(preview.creditCost, 28);
  assert.deepEqual(state.navigations, [legacyProbeUrl(state.clean()), legacyRewriteUrl(state), accountHistoryUrl, state.clean()]);
  assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
});

for (const seedInterrupted of [false, true]) {
  test(`preview follows a source-home seed redirect to signed history without repeating the seed (interrupted: ${seedInterrupted})`, async t => {
    const state = await fixture(t, { seedHome: "https://www.3d66.com/", seedInterrupted });
    const preview = await fetch3D66Preview(state.source, cookie);
    const resolved = new URL(preview.resolvedSourceUrl);
    resolved.hash = "";
    assert.equal(resolved.href, state.clean());
    assert.deepEqual(state.navigations, [state.seed().url, "https://user.3d66.com/newUser/index/index/footprint"]);
    assert.deepEqual(state.requests, ["/api/v1/download/pop"]);
    assert.equal(state.contexts(), 1);
    assert.ok(!state.navigations.includes(state.source));
  });
}

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
        { code: name === "another ID sharing the suffix" ? "THREED66_CLEAN_LINK_REQUIRED" : "THREED66_REWRITTEN_FOOTPRINT_FAILED" });
    }
    assert.deepEqual(state.requests, []);
  });
}

function openedCardFixture({ navigation = "", downloadRequest = false, changedHref = false, challenge = false, sketchup = false,
  redirect = "", unknownParent = false, redirectBypassesRoute = false } = {}) {
  const source = sketchup ? "https://su.3d66.com/reshtmla/sketchup/items/fixture/canonical.html"
    : "https://3d.3d66.com/reshtmla/model/items/fixture/canonical.html";
  const seed = build3D66FootprintSeed(source + "?sof=GCI139810814629725");
  const unsigned = `${seed.modelPage}?sof=${seed.productId}&st=2`;
  const signed = unsigned + "&sign=real-history-fixture";
  const finalUrl = redirect || signed;
  const actions = [];
  let guard;
  let redirectListener;
  const opened = { url: () => finalUrl, async waitForLoadState() {},
    async title() { return challenge ? "滑动验证页面" : "Fixture model"; },
    async waitForURL(predicate) { assert.equal(predicate(new URL(finalUrl)), true); } };
  const context = {
    async route(_pattern, callback) { guard = callback; },
    async unroute(_pattern, callback) { assert.equal(callback, guard); actions.push("unroute"); },
    on(event, callback) { assert.equal(event, "request"); redirectListener = callback; },
    off(event, callback) { assert.equal(event, "request"); assert.equal(callback, redirectListener); redirectListener = null; },
  };
  const page = {
    locator() { return { nth(index) {
      assert.equal(index, 2);
      return {
        async evaluate(read) { return read({ href: changedHref ? signed : unsigned }); },
        async click(options) {
          actions.push("pointer-click");
          assert.equal(options.noWaitAfter, true);
          if (redirect) {
            const parent = { url: () => unsigned, isNavigationRequest: () => true, redirectedFrom: () => null };
            const next = { url: () => redirect, isNavigationRequest: () => true, redirectedFrom: () => unknownParent ? { ...parent } : parent };
            for (const request of [parent, next]) {
              if (request === next && redirectBypassesRoute) { redirectListener(request); actions.push("redirect-network"); continue; }
              await guard({ request: () => request, async abort() { actions.push("blocked"); },
                async fallback() { actions.push("network"); } });
            }
          }
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
  assert.deepEqual(await open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
    { url: state.signed, canonicalModelPage: state.seed.modelPage });
  assert.deepEqual(state.actions, ["pointer-click", "blocked", "unroute"]);
});

test("SketchUp history cards can open a signature but cannot navigate to another resource or model", async () => {
  const valid = openedCardFixture({ sketchup: true, downloadRequest: true });
  assert.equal((await open3D66RewrittenFootprintCard(valid.page, valid.card, valid.seed, valid.context)).url, valid.signed);
  assert.deepEqual(valid.actions, ["pointer-click", "blocked", "unroute"]);
  for (const navigation of [valid.signed.replace("canonical.html", "other.html"),
    valid.signed.replace("su.3d66.com/reshtmla/sketchup", "3d.3d66.com/reshtmla/model")]) {
    const state = openedCardFixture({ sketchup: true, navigation });
    await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
      error => error.details?.reason === "opened_model_mismatch");
    assert.deepEqual(state.actions, ["pointer-click", "blocked", "unroute"]);
  }
});

test("SketchUp canonical redirects stay in the SU resource even when a Max link has the same ID", async () => {
  const canonical = "https://su.3d66.com/reshtmla/sketchup/items/fixture/account-canonical.html?sof=ACI896357714629725&sign=server-fixture";
  const valid = openedCardFixture({ sketchup: true, redirect: canonical });
  assert.equal((await open3D66RewrittenFootprintCard(valid.page, valid.card, valid.seed, valid.context)).url, canonical);
  for (const redirectBypassesRoute of [false, true]) {
    const state = openedCardFixture({ sketchup: true, redirectBypassesRoute,
      redirect: canonical.replace("su.3d66.com/reshtmla/sketchup", "3d.3d66.com/reshtmla/model") });
    await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context));
    assert.equal(state.actions.includes("unroute"), true);
  }
});

test("the exact history request may redirect to a server-signed canonical path for the same full model ID", async () => {
  const url = "https://3d.3d66.com/reshtmla/model/items/fixture/server-canonical.html?sof=ACI896357714629725&st=2&sign=server-fixture";
  for (const redirectBypassesRoute of [false, true]) {
    const state = openedCardFixture({ redirect: url, redirectBypassesRoute });
    assert.deepEqual(await open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
      { url, canonicalModelPage: "https://3d.3d66.com/reshtmla/model/items/fixture/server-canonical.html" });
    assert.deepEqual(state.actions, ["pointer-click", "network", redirectBypassesRoute ? "redirect-network" : "network", "unroute"]);
  }
});

test("canonical redirects reject missing signatures, other IDs, unsafe origins and an unobserved parent request", async () => {
  const canonical = "https://3d.3d66.com/reshtmla/model/items/fixture/server-canonical.html?sof=ACI896357714629725&st=2&sign=server-fixture";
  for (const options of [{ redirect: canonical, unknownParent: true },
    ...[canonical.replace("&sign=server-fixture", ""), canonical.replace("server-fixture", ""),
      canonical.replace("ACI896357714629725", "ACI89635771994629725"), canonical + "&sof=ACI896357714629725",
      canonical.replace("https:", "http:"), canonical.replace("3d.3d66.com", "evil.test")].map(redirect => ({ redirect }))]) {
    const state = openedCardFixture(options);
    await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context),
      error => error.details?.reason === "opened_model_mismatch");
    assert.deepEqual(state.actions, ["pointer-click", "network", "blocked", "unroute"]);
  }
});

test("unrouted redirect events cannot authorize an unsigned, wrong-ID or unrelated canonical page", async () => {
  const canonical = "https://3d.3d66.com/reshtmla/model/items/fixture/server-canonical.html?sof=ACI896357714629725&sign=server-fixture";
  for (const options of [{ redirect: canonical, unknownParent: true },
    { redirect: canonical.replace("&sign=server-fixture", "") },
    { redirect: canonical.replace("ACI896357714629725", "ACI89635771994629725") }]) {
    const state = openedCardFixture({ ...options, redirectBypassesRoute: true });
    await assert.rejects(open3D66RewrittenFootprintCard(state.page, state.card, state.seed, state.context));
    assert.deepEqual(state.actions, ["pointer-click", "network", "redirect-network", "unroute"]);
  }
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
