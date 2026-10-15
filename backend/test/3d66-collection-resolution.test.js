import assert from "node:assert/strict";
import test from "node:test";
import { collectionModelPage, collectionResolutionConfig, create3D66CollectionResolver,
  resolve3D66CollectionPage, selectCollectionModelLink } from "../src/utils/3d66CollectionResolver.js";
import { isSwitchable3D66Error, shouldDegrade3D66Cookie } from "../src/utils/3d66CookiePool.js";

const sourceId = "BCH01077971442400";
const accountId = "BCH89635771442400";
const base = "https://3d.3d66.com/reshtmla/model/items/fixture/collection-model.html";
const source = `${base}?sof=${sourceId}&sign=old-fixture`;
const clean = `${base}?sof=${accountId}&lss=28&sign=collection-fixture`;
const config = collectionResolutionConfig({ THREED66_COLLECTION_ID: "123456", THREED66_COLLECTION_USER: "ACJ00000001" });

function fixture(options = {}) {
  let current = "about:blank";
  const actions = [];
  const page = {
    url: () => current,
    async waitForLoadState(state) { actions.push(state); },
    async waitForTimeout() { actions.push("delay"); },
    locator(selector) {
      if (selector === ".collect-btn.details-gallery-favorites") return {
        async waitFor() {},
        async getAttribute() { return options.sourceId || sourceId; },
        async click() { actions.push("open-favorites"); },
      };
      if (selector.startsWith("li[data-id=")) return {
        async waitFor() { if (options.missingCollection) throw new Error("Target collection missing"); },
        async count() { return options.collectionCount || 1; },
        async getAttribute() { return options.saved ? "clearfix active" : "clearfix"; },
        locator() { return { async textContent() { return options.savedText || "收藏"; } }; },
        async click() { actions.push(`save:${selector}`); },
      };
      return {
        first() { return { async waitFor() {} }; },
        async evaluateAll(read) {
          let links = [];
          if (selector === 'a[href*="/inspiration/favorites_other/detail"]') links = options.entries || [config.detailUrl];
          else if (selector === "a.box-images[href]") {
            links = typeof options.cards === "function" ? options.cards(current, actions) : options.cards || [clean];
          } else links = options.next?.[current] || [];
          return read(links.map((href) => ({ href })));
        },
      };
    },
  };
  async function navigate(_page, href) {
    actions.push(href);
    current = options.redirects?.[href] || href;
  }
  return { page, navigate, actions };
}

test("collection configuration is explicit and cannot inject selectors or external URLs", () => {
  assert.equal(config.detailUrl, "https://user.3d66.com/inspiration/favorites_other/detail?id=123456&res_type=1&aui=ACJ00000001");
  for (const overrides of [{}, { THREED66_COLLECTION_ID: '123"]', THREED66_COLLECTION_USER: "ACJ00000001" },
    { THREED66_COLLECTION_ID: "123", THREED66_COLLECTION_USER: "https://evil.test" }]) {
    assert.throws(() => collectionResolutionConfig(overrides), { status: 503, code: "THREED66_COLLECTION_RESOLUTION_FAILED" });
  }
});

test("collection mode requires an actual HTTPS 3D model page", () => {
  for (const url of ["http://3d.3d66.com/reshtmla/model/items/a/model.html", "https://evil.test/model.html",
    "https://user:password@3d.3d66.com/reshtmla/model/items/a/model.html", `${source}&sof=${accountId}`,
    `${source}&id=${accountId}`, `${source}&id=${sourceId}&id=${sourceId}`,
    "https://3d.3d66.com/reshtmla/model/items/id/model.html", "https://cad.3d66.com/reshtmla/cad/items/a/model.html"]) {
    assert.throws(() => collectionModelPage(url), { code: "THREED66_COLLECTION_RESOLUTION_FAILED" });
  }
  assert.equal(collectionModelPage(`${source}#resolved=footprint`).hash, "");
});

test("collection links require both the exact model page and matching account/asset identity", () => {
  const unrelated = clean.replace("collection-model.html", "other-model.html");
  assert.equal(selectCollectionModelLink([unrelated, clean], source, sourceId).url, clean);
  assert.equal(selectCollectionModelLink([unrelated], source, sourceId), null);
  for (const url of [clean.replace(accountId, sourceId), clean.replace(accountId, "BCH89635771999999"),
    clean.replace("&sign=collection-fixture", ""), `${clean}&sof=${accountId}`, `${clean}&sign=second`]) {
    assert.throws(() => selectCollectionModelLink([url], source, sourceId), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  }
});

test("collection resolver visits the submitted model, saves to the exact folder, then reads its signed card", async () => {
  const state = fixture();
  const result = await resolve3D66CollectionPage({ ...state, url: source, config, expectedProductId: sourceId });
  assert.deepEqual(result, { url: clean, productId: accountId, usedCollection: true });
  assert.deepEqual(state.actions, [source, "open-favorites", 'save:li[data-id="123456"][data-type="1"]',
    "networkidle", config.profileUrl, config.detailUrl]);
});

for (const options of [{ saved: true }, { savedText: "已收藏" }]) {
  test(`already-collected models are not toggled off (${JSON.stringify(options)})`, async () => {
    const state = fixture(options);
    await resolve3D66CollectionPage({ ...state, url: source, config });
    assert.ok(!state.actions.some((action) => action.startsWith("save:")));
  });
}

test("wrong source metadata is rejected before changing any collection", async () => {
  const state = fixture({ sourceId: "BCH89635771999999" });
  await assert.rejects(resolve3D66CollectionPage({ ...state, url: source, config, expectedProductId: sourceId }),
    (error) => error.details.reason === "source_model_identity_mismatch");
  assert.deepEqual(state.actions, [source]);
});

test("collection resolution never selects a different collection or first unrelated model", async () => {
  const state = fixture({ entries: [config.detailUrl.replace("123456", "999999")],
    cards: [clean.replace("collection-model.html", "unrelated.html")] });
  await assert.rejects(resolve3D66CollectionPage({ ...state, url: source, config, refreshAttempts: 2 }),
    (error) => error.details.reason === "model_not_found_in_collection");
  assert.equal(state.actions.filter((action) => action === config.detailUrl).length, 2);
  assert.ok(!state.actions.some((action) => action.includes("999999")));
});

test("bounded collection refresh can find a delayed save without saving a second time", async () => {
  const state = fixture({ cards: (_url, actions) => actions.includes("delay") ? [clean] : [] });
  const result = await resolve3D66CollectionPage({ ...state, url: source, config, refreshAttempts: 2 });
  assert.equal(result.url, clean);
  assert.equal(state.actions.filter((action) => action.startsWith("save:")).length, 1);
});

test("collection pagination follows only same-owner, same-collection links and rejects cycles", async () => {
  const second = `${config.detailUrl}&page=2`;
  const state = fixture({ saved: true, cards: (url) => url === second ? [clean] : [],
    next: { [config.detailUrl]: ["https://evil.test/next", config.detailUrl.replace("ACJ00000001", "ACJ99999999"), second] } });
  assert.equal((await resolve3D66CollectionPage({ ...state, url: source, config })).url, clean);
  const cyclic = fixture({ saved: true, cards: [], next: { [config.detailUrl]: [second], [second]: [config.detailUrl] } });
  await assert.rejects(resolve3D66CollectionPage({ ...cyclic, url: source, config, refreshAttempts: 1, maxPages: 5 }));
  assert.equal(cyclic.actions.filter((item) => item === second).length, 1);
});

test("redirects to another model, profile or favorites page fail closed", async () => {
  for (const [from, to] of [[source, source.replace("collection-model.html", "other.html")],
    [config.profileUrl, "https://user.3d66.com/login"], [config.detailUrl, config.detailUrl.replace("123456", "654321")]]) {
    const state = fixture({ redirects: { [from]: to } });
    await assert.rejects(resolve3D66CollectionPage({ ...state, url: source, config }), { code: "THREED66_COLLECTION_RESOLUTION_FAILED" });
  }
});

test("collection errors are terminal and do not degrade or rotate account cookies", async () => {
  const state = fixture({ missingCollection: true });
  const resolver = create3D66CollectionResolver({ navigate: state.navigate, serializeCookies: () => "updated-fixture",
    withBrowserContext: async (_url, _cookie, callback, options) => {
      assert.equal(options.allowProxyFallback, false);
      return callback({ page: state.page, context: { cookies: async () => [] } });
    } });
  await assert.rejects(resolver(source, "fixture-cookie", sourceId, config), (error) => {
    assert.equal(error.code, "THREED66_COLLECTION_RESOLUTION_FAILED");
    assert.equal(isSwitchable3D66Error(error), false);
    assert.equal(shouldDegrade3D66Cookie(error), false);
    return true;
  });
  assert.ok(!state.actions.some((action) => action.startsWith("save:")));
});

test("collection mutations serialize per folder and release their slot after an error", async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const resolver = create3D66CollectionResolver({ serializeCookies: () => "updated-fixture", navigate: async () => {},
    withBrowserContext: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      const call = ++calls;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (call === 1) throw new Error("Fixture failure");
      return { url: clean, productId: accountId };
    } });
  const results = await Promise.allSettled([resolver(source, "cookie", sourceId, config), resolver(source, "cookie", sourceId, config)]);
  assert.equal(maximum, 1);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
});
