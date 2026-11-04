import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const serviceUrl = new URL("../src/utils/3d66Service.js", import.meta.url).href;
const cookiePoolUrl = new URL("../src/utils/3d66CookiePool.js", import.meta.url).href;
// Replace upstream entry points before importing the controller; no browser or network is loaded.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === serviceUrl) {
      return { format: "module", shortCircuit: true, source: `
        export const fixture = { calls: [], cookieValue: "fixture-cookie", result: {}, error: null };
        export async function fetch3D66Preview(...args) {
          fixture.calls.push(args);
          if (fixture.error) throw fixture.error;
          return { ...fixture.result };
        }
        function forbidden() { throw new Error("Unexpected upstream/download operation"); }
        export { forbidden as fetchFrom3D66, forbidden as inspect3D66DownloadChoice,
          forbidden as inspect3D66DownloadFormats, forbidden as inspect3D66Page,
          forbidden as request3D66File };
      ` };
    }
    if (url === cookiePoolUrl) {
      return { format: "module", shortCircuit: true, source: `
        import { fixture } from ${JSON.stringify(serviceUrl)};
        export function with3D66Cookie(task) { return task(fixture.cookieValue); }
      ` };
    }
    return nextLoad(url, context);
  },
});
const { fixture: upstream } = await import(serviceUrl);
const { previewGetlink, prepareGetlinkPreview, getLink, inspectGetlink } = await import("../src/controllers/getlinkController.js");
const { default: router } = await import("../src/routes/getlinkRoutes.js");
hooks.deregister();
const { default: ProductCache } = await import("../src/models/ProductCache.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: User } = await import("../src/models/User.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { updateSettings, initializeSettings, getSettings } = await import("../src/controllers/settingsController.js");
const { productionReadinessIssues } = await import("../src/config/productionReadiness.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { queue3D66Preview } = await import("../src/utils/3d66Queue.js");

const productId = "BCH01089635771001";
const sourceUrl = `https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=${productId}&sign=fixture`;
const imageUrl = "https://respic.3d66.com/fixture.jpg";
const format = { key: "max|2022|vray", fileFormat: "max", formatVersion: "2022", rendererType: "vray", isDefault: true };
let previousEnv;
let user;
let sequence = 0;

beforeEach(async (t) => {
  previousEnv = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test", THREED66_MODEL_RESOLVE_MODE: "hybrid", THREED66_MOCK: "false",
    THREED66_REQUIRED_ACCOUNT_MARKER: "89635771", ADMIN_EMAILS: "admin@example.test",
  });
  for (const model of [ProductCache, Getlink, User, SiteSetting]) await model.deleteMany({});
  user = await User.create({ email: `preview-${++sequence}@example.test`, credit: 100 });
  Object.assign(upstream, {
    calls: [], cookieValue: "fixture-cookie", error: null,
    result: { productId, title: "Fixture model", sourceUrl, resolvedSourceUrl: sourceUrl,
      imageUrl, creditCost: 28, priceKnown: true, formatOptions: [format] },
  });
  t.mock.method(globalThis, "fetch", async () => assert.fail("No network requests allowed"));
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
});

function request(body = { url: sourceUrl }, overrides = {}) {
  return { body, user, method: "POST", path: "/api/getlink/preview", query: {}, params: {},
    protocol: "https", ip: `192.0.2.${sequence}`, cookies: { csrfSecret: "fixture-csrf-secret" },
    get: () => "", isAuthenticated: () => true, ...overrides };
}

function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

async function invoke(handler, req = request()) {
  const res = response();
  await handler(req, res, (error) => { throw error; });
  return res;
}

async function paidCache() {
  return ProductCache.create({ productId, sourceUrl, resolvedSourceUrl: sourceUrl, title: "Cached model",
    imageUrl, creditCost: 28, priceKnown: true, fileUrl: "https://download.3d66.com/fixture.zip",
    isPurchased: true, formatOptions: [format], formatOptionsVersion: 5, formatOptionsCheckedAt: new Date() });
}

async function assertUncharged() {
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await Getlink.countDocuments({}), 0);
}

test("hybrid progressive preview bypasses full cache and leaves paid and verified cache untouched", async (t) => {
  const cache = await paidCache();
  const before = JSON.parse(JSON.stringify(await ProductCache.findById(cache._id)));
  t.mock.method(ProductCache, "findOne", () => assert.fail("Fast metadata must bypass the shared cache"));
  const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(upstream.calls, [[sourceUrl, "fixture-cookie", { includeFormatOptions: false, progressive: true }]]);
  assert.equal(res.body.preparationStatus, "pending");
  assert.equal(res.body.imageUrl, imageUrl);
  assert.equal(res.body.metadataIncomplete, false);
  assert.equal(res.body.cached, false);
  assert.deepEqual(res.body.formatOptions, []);
  assert.equal(res.body.selectedFormat, null);
  assert.equal(res.body.hasDownloadFormats, false);
  assert.equal(Object.hasOwn(res.body, "resolvedSourceUrl"), false);
  assert.equal(Object.hasOwn(res.body, "fileUrl"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(await ProductCache.findById(cache._id))), before);
  await assertUncharged();
});

test("fast metadata creates no cache record and does not persist an unverified resolved source", async () => {
  upstream.result.resolvedSourceUrl = "https://3d.3d66.com/unverified?sign=sender";
  const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
  assert.equal(res.body.preparationStatus, "pending");
  assert.equal(await ProductCache.countDocuments({}), 0);
  await assertUncharged();
});

test("fast metadata does not wait behind a busy browser preparation queue", async () => {
  let release;
  const busy = queue3D66Preview(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  let timer;
  try {
    const res = await Promise.race([
      invoke(previewGetlink, request({ url: sourceUrl, progressive: true })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Metadata blocked behind Chromium")), 1000); }),
    ]);
    assert.equal(res.body.preparationStatus, "pending");
  } finally {
    clearTimeout(timer);
    release();
    await busy;
  }
});

test("fast metadata exposes real API file choices without treating them as download authority", async () => {
  upstream.result.formatOptionsSource = "api";
  const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
  assert.equal(res.body.preparationStatus, "pending");
  assert.deepEqual(res.body.formatOptions, [format]);
  assert.equal(res.body.selectedFormat.key, format.key);
  assert.equal(res.body.hasDownloadFormats, true);
  assert.equal(Object.hasOwn(res.body, "resolvedSourceUrl"), false);
  assert.equal(await ProductCache.countDocuments({}), 0);
  await assertUncharged();
});

for (const metadata of [
  { title: "", imageUrl: "", creditCost: 0, priceKnown: false },
  { metadataIncomplete: true },
  { imageUrl: "http://127.0.0.1/private" },
  { imageUrl: "https://example.test/image.jpg" },
  { imageUrl: "https://user:password@respic.3d66.com/image.jpg" },
  { creditCost: 1, priceKnown: false },
]) {
  test(`progressive incomplete metadata remains pending and non-persistent: ${JSON.stringify(metadata)}`, async () => {
    Object.assign(upstream.result, metadata);
    const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.preparationStatus, "pending");
    assert.equal(res.body.metadataIncomplete, true);
    if (metadata.imageUrl !== undefined) assert.equal(res.body.imageUrl, "");
    assert.equal(await ProductCache.countDocuments({}), 0);
    await assertUncharged();
  });
}

test("progressive image URLs use the existing HTTPS 3D66 allowlist and normalize relative images", async () => {
  upstream.result.imageUrl = "//respic.3d66.com/relative.jpg";
  const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
  assert.equal(res.body.imageUrl, "https://respic.3d66.com/relative.jpg");
});

for (const [label, invalidUrl] of [
  ["duplicate sof", `${sourceUrl}&sof=${productId}`],
  ["duplicate sign", `${sourceUrl}&sign=second-fixture`],
  ["duplicate id", `${sourceUrl}&id=${productId}&id=${productId}`],
  ["conflicting id", `${sourceUrl}&id=ACH89635771654321`],
  ["placeholder model page", sourceUrl.replace("/items/fixture/", "/items/id/")],
]) {
  test(`hybrid rejects ${label} before cache and service in real and mock modes`, async (t) => {
    t.mock.method(ProductCache, "findOne", () => assert.fail("Invalid input must not reach the shared cache"));
    for (const mock of ["false", "true"]) {
      process.env.THREED66_MOCK = mock;
      for (const [handler, extra] of [[previewGetlink, {}], [previewGetlink, { progressive: true }],
        [prepareGetlinkPreview, {}], [getLink, {}]]) {
        const res = await invoke(handler, request({ url: invalidUrl, ...extra }));
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "THREED66_HYBRID_INPUT_INVALID");
      }
    }
    assert.equal(upstream.calls.length, 0);
    await assertUncharged();
  });
}

test("hybrid rejects ID-only input before the mocked service, while accepting a real unsigned model page", async () => {
  process.env.THREED66_MOCK = "true";
  const invalid = await invoke(previewGetlink, request({ modelId: productId, progressive: true }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, "THREED66_HYBRID_INPUT_INVALID");
  assert.equal(upstream.calls.length, 0);
  const unsigned = sourceUrl.replace("&sign=fixture", "");
  const valid = await invoke(previewGetlink, request({ url: unsigned, progressive: true }));
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.preparationStatus, "pending");
  assert.equal(upstream.calls[0][0], unsigned);
});

for (const progressive of ["true", "false", 0, 1, null, [], {}, undefined]) {
  test(`preview rejects a non-boolean progressive value: ${JSON.stringify(progressive)}`, async () => {
    const res = await invoke(previewGetlink, request({ url: sourceUrl, progressive }));
    assert.equal(res.statusCode, 400);
    assert.equal(upstream.calls.length, 0);
    assert.equal(await ProductCache.countDocuments({}), 0);
  });
}

for (const [label, handler, body] of [
  ["default preview", previewGetlink, { url: sourceUrl }],
  ["explicit full preview", previewGetlink, { url: sourceUrl, progressive: false }],
  ["prepare", prepareGetlinkPreview, { url: sourceUrl }],
]) {
  test(`hybrid ${label} verifies through the service even with fresh shared formats`, async () => {
    const cache = await paidCache();
    const res = await invoke(handler, request(body));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.preparationStatus, "ready");
    assert.equal(res.body.title, "Fixture model");
    assert.deepEqual(res.body.formatOptions, [format]);
    assert.ok(res.body.imageUrl.includes(`/api/getlink/preview-cache/${productId}`));
    assert.deepEqual(upstream.calls[0][2], { includeFormatOptions: true, progressive: false });
    assert.equal((await ProductCache.findById(cache._id)).fileUrl, cache.fileUrl);
    assert.equal((await ProductCache.findById(cache._id)).isPurchased, true);
    await assertUncharged();
  });
}

test("hybrid full preview never substitutes shared cache after credential-bound verification fails", async () => {
  const cache = await paidCache();
  upstream.error = Object.assign(new Error("Verification required"), { status: 409, code: "THREED66_VERIFICATION_REQUIRED" });
  await assert.rejects(invoke(prepareGetlinkPreview), { code: "THREED66_VERIFICATION_REQUIRED" });
  assert.equal((await ProductCache.findById(cache._id)).title, "Cached model");
  await assertUncharged();
});

test("a verified hybrid preview cannot relabel previously purchased foreign-account bytes as clean", async () => {
  const cache = await paidCache();
  const valid = new URL(sourceUrl);
  valid.searchParams.set("sof", "ACH89635771771001");
  upstream.result.resolvedSourceUrl = valid.href;
  upstream.result.formatsChecked = true;
  const res = await invoke(prepareGetlinkPreview);
  assert.equal(res.body.preparationStatus, "ready");
  const after = await ProductCache.findById(cache._id);
  assert.equal(after.resolvedSourceUrl, cache.resolvedSourceUrl);
  assert.equal(after.sourceUrl, cache.sourceUrl);
  assert.equal(after.fileUrl, cache.fileUrl);
  assert.equal(after.isPurchased, true);
  await assertUncharged();
});

test("hybrid preparation of an uncached model never marks a preview as purchased", async () => {
  await invoke(prepareGetlinkPreview);
  const cache = await ProductCache.findOne({ productId });
  assert.equal(cache.isPurchased, false);
  assert.equal(Boolean(cache.fileUrl), false);
  await assertUncharged();
});

test("each hybrid preparation invokes the service with the active credential, not the product cache", async () => {
  await paidCache();
  await invoke(prepareGetlinkPreview);
  upstream.cookieValue = "rotated-fixture-cookie";
  await invoke(prepareGetlinkPreview);
  assert.deepEqual(upstream.calls.map((call) => call[1]), ["fixture-cookie", "rotated-fixture-cookie"]);
});

test("incomplete full metadata retains the existing 422 behavior and is never cached", async () => {
  upstream.result.metadataIncomplete = true;
  const res = await invoke(prepareGetlinkPreview);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.metadataIncomplete, true);
  assert.equal(await ProductCache.countDocuments({}), 0);
  await assertUncharged();
});

for (const handler of [prepareGetlinkPreview, getLink, inspectGetlink]) {
  test(`${handler.name} rejects progressive even when false`, async () => {
    for (const progressive of [true, false]) {
      const res = await invoke(handler, request({ url: sourceUrl, progressive }));
      assert.equal(res.statusCode, 400);
    }
    assert.equal(upstream.calls.length, 0);
    await assertUncharged();
  });
}

test("non-hybrid modes keep full behavior and fresh shared cache compatibility", async () => {
  process.env.THREED66_MODEL_RESOLVE_MODE = "direct";
  const full = await invoke(previewGetlink, request({ url: sourceUrl, progressive: true }));
  assert.equal(full.statusCode, 200);
  assert.equal(full.body.preparationStatus, undefined);
  assert.deepEqual(upstream.calls[0][2], { includeFormatOptions: true, progressive: false });
  const cached = await invoke(previewGetlink);
  assert.equal(cached.statusCode, 200);
  assert.equal(upstream.calls.length, 1);
  assert.deepEqual(cached.body.formatOptions, [format]);
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "direct");
});

function routeHandlers(path) {
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  assert.equal(route?.methods.post, true);
  return route.stack.map((layer) => layer.handle);
}

async function invokeRoute(path, req) {
  const res = response();
  for (const handler of routeHandlers(path)) {
    let continued = false;
    await handler(req, res, (error) => { assert.ifError(error); continued = true; });
    if (!continued) break;
  }
  return res;
}

test("prepare uses the same authentication, ban and both rate-limit middleware as preview", async () => {
  const previewHandlers = routeHandlers("/getlink/preview");
  const prepareHandlers = routeHandlers("/getlink/preview/prepare");
  assert.deepEqual(prepareHandlers.slice(0, -1), previewHandlers.slice(0, -1));
  const unauthenticated = await invokeRoute("/getlink/preview/prepare", request({}, { user: null, isAuthenticated: () => false }));
  assert.equal(unauthenticated.statusCode, 401);
  const banned = await invokeRoute("/getlink/preview/prepare", request({}, { user: { ...user, isBanned: true } }));
  assert.equal(banned.statusCode, 403);
  assert.equal(banned.body.code, "ACCOUNT_BANNED");
  assert.equal(upstream.calls.length, 0);
});

test("preview and prepare share the per-user limit rather than doubling the allowance", async () => {
  for (let i = 0; i < 30; i += 1) {
    const path = i % 2 ? "/getlink/preview" : "/getlink/preview/prepare";
    assert.equal((await invokeRoute(path, request({}))).statusCode, 400);
  }
  assert.equal((await invokeRoute("/getlink/preview/prepare", request({}))).statusCode, 429);
});

test("both POST preview endpoints require a valid CSRF token under the global middleware", async () => {
  for (const path of ["/api/getlink/preview", "/api/getlink/preview/prepare"]) {
    const req = request({}, { path });
    const invalid = await invoke(csrfProtection, req);
    assert.equal(invalid.statusCode, 403);
    let token;
    issueCsrfToken(req, { json(body) { token = body.csrfToken; } });
    req.get = (name) => name === "x-csrf-token" ? token : "";
    let continued = false;
    csrfProtection(req, response(), () => { continued = true; });
    assert.equal(continued, true);
  }
});

test("hybrid settings persist explicitly, survive initialization, and remain the public input mode", async () => {
  await SiteSetting.create({ key: "homepage", threed66ModelResolveMode: "search" });
  const saved = await invoke(updateSettings, request({ threed66ModelResolveMode: "hybrid" }));
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.settings.threed66ModelResolveMode, "hybrid");
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "hybrid");
  process.env.THREED66_MODEL_RESOLVE_MODE = "search";
  await initializeSettings();
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "hybrid");
  const publicResult = await invoke(getSettings, request({}, { user: null }));
  assert.equal(publicResult.body.settings.threed66ModelResolveMode, "hybrid");
});

test("production mode validation accepts hybrid and rejects typos without changing modes", () => {
  const errors = (mode) => productionReadinessIssues({ NODE_ENV: "production", THREED66_MODEL_RESOLVE_MODE: mode }).errors
    .filter((message) => message.includes("THREED66_MODEL_RESOLVE_MODE"));
  for (const mode of ["search", "footprint", "direct", "collection", "rewritten_footprint", "hybrid", ""]) {
    assert.deepEqual(errors(mode), []);
  }
  assert.equal(errors("hybird").length, 1);
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "hybrid");
});
