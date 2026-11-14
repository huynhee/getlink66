import assert from "node:assert/strict";
import test from "node:test";
import { seal3D66CadVerification, read3D66CadVerification, cadCredentialDigest, CAD_VERIFICATION_TTL_MS } from "../src/utils/3d66CadProof.js";
import { assert3D66CleanModelUrl, assert3D66StoredDownload } from "../src/utils/3d66CleanLink.js";
import { verify3D66CadPage } from "../src/utils/3d66CadPage.js";

const id = "AJI896357714629725";
const base = "https://cad.3d66.com/reshtmla/cad/items/fixture/model.html";
const url = `${base}?sof=${id}&st=2`;
const cookie = "PHPSESSID=cad-fixture; login_sign=cad-login";
const configuration = "a".repeat(64);
const claims = { url, accountId: "177536980", assetId: "4629725", marker: "89635771", cookieValue: cookie, configurationKey: configuration };

test("unsigned CAD needs an authentic backend receipt; 3D/SU still need a source sign", () => {
  assert.throws(() => assert3D66CleanModelUrl(url));
  const verified = seal3D66CadVerification(claims);
  assert.equal(new URL(verified).searchParams.has("sign"), false);
  assert.equal(assert3D66CleanModelUrl(verified), id);
  for (const value of [verified.replace("cad.3d66.com/reshtmla/cad", "3d.3d66.com/reshtmla/model"),
    verified.replace("cad.3d66.com/reshtmla/cad", "su.3d66.com/reshtmla/sketchup"),
    verified.replace("model.html", "other.html"), verified.replace(id, "AJI89635771994629725"),
    verified + "&cad_verified=duplicate", verified.replace(/.$/, "!"),
    verified.replace("&st=2", "&st=2&sof=" + id), verified.replace("&st=2", "&st=2&sign="),
    verified.replace("&st=2", "&st=2&sign=one&sign=two")]) {
    assert.throws(() => assert3D66CleanModelUrl(value));
  }
});

test("CAD receipts bind the complete asset, account, credential and configuration", () => {
  const verified = seal3D66CadVerification(claims);
  assert.ok(read3D66CadVerification(verified, { cookieValue: cookie, configurationKey: configuration, fresh: true }));
  assert.equal(read3D66CadVerification(verified, { cookieValue: cookie.replace("cad-login", "different") }), null);
  assert.equal(read3D66CadVerification(verified, { configurationKey: "b".repeat(64) }), null);
  assert.equal(cadCredentialDigest(cookie + "; analytics=new"), cadCredentialDigest(cookie));
  assert.throws(() => seal3D66CadVerification({ ...claims, assetId: "994629725" }));
  assert.throws(() => seal3D66CadVerification({ ...claims, accountId: "999999999" }));
  assert.throws(() => assert3D66CleanModelUrl(verified, { expectedProductId: "GJI13981081994629725" }));
});

test("a historical CAD receipt survives expiry but cannot authorize a fresh purchase", t => {
  const verified = seal3D66CadVerification({ ...claims, at: Date.now() - CAD_VERIFICATION_TTL_MS - 1000 });
  assert.ok(read3D66CadVerification(verified));
  assert.equal(read3D66CadVerification(verified, { fresh: true }), null);
  const old = process.env.THREED66_MOCK; process.env.THREED66_MOCK = "false";
  t.after(() => { if (old === undefined) delete process.env.THREED66_MOCK; else process.env.THREED66_MOCK = old; });
  assert.doesNotThrow(() => assert3D66StoredDownload({ productId: "GJI139810814629725", resolvedSourceUrl: verified }));
});

function fixture(options = {}) {
  const doc = { pageUrl: url, code: 200, productId: id, publicAssetId: 21681188, resourceType: 8,
    deleted: 0, sourceAccountId: 177536980, originUrl: url, price: 28, fileFormat: 8, formatVersion: "2014", suffix: "DWG",
    ...options.document };
  const calls = [];
  let reads = 0;
  const response = data => ({ ok: () => true, status: () => 200, async body() { return Buffer.from(JSON.stringify(data)); }, async dispose() {} });
  const page = { async evaluate() { reads++; return options.changed && reads > 1 ? { ...doc, publicAssetId: 994629725 } : doc; } };
  const context = { request: {
    async get(endpoint, request) {
      calls.push(endpoint); assert.equal(request.maxRedirects, 0); assert.equal(request.headers.cookie, cookie);
      return options.accountRedirect ? { ...response({}), status: () => 302 } : response({ code: 200, data: { basic: { user_id: options.accountId || 177536980 } } });
    },
    async post(endpoint, request) {
      calls.push(endpoint); assert.equal(endpoint, "https://user.3d66.com/api/v1/download/pop");
      assert.deepEqual(request.form, { sof: id, res_type: "8" }); assert.equal(request.maxRedirects, 0);
      return response({ status: 200, ...options.popStatus, data: { token: "fixture-only", resInfo: {
        sof: id, res_type: 8, is_delete: 0, res_price: 28, ...options.info,
      } } });
    },
  } };
  return { calls, run: () => verify3D66CadPage({ page, context, expectedId: id, cookieValue: cookie, configurationKey: configuration }) };
}

test("CAD verification checks authenticated account, full DOM asset and read-only API before sealing", async () => {
  const state = fixture(); const result = await state.run();
  assert.equal(assert3D66CleanModelUrl(result.url), id);
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls.some(value => value.endsWith("/handle")), false);
});

test("CAD without origin_ll_url binds the actual loaded CAD page to the same DOM and API identity", async () => {
  for (const originUrl of [undefined, null, ""]) {
    const result = await fixture({ document: { originUrl } }).run();
    assert.equal(read3D66CadVerification(result.url).url, url);
  }
});

for (const [label, options] of [
  ["wrong account", { accountId: 999999999 }], ["wrong source account", { document: { sourceAccountId: 999999999 } }],
  ["login redirect", { accountRedirect: true }], ["wrong DOM asset", { document: { productId: "AJI89635771994629725" } }],
  ["missing public asset", { document: { publicAssetId: null } }],
  ["wrong resource", { document: { resourceType: 1 } }], ["deleted DOM", { document: { deleted: 1 } }],
  ["missing deletion flag", { document: { deleted: undefined } }], ["foreign origin link", { document: { originUrl: url.replace(id, "AJI139810814629725") } }],
  ["invalid explicit origin link", { document: { originUrl: "https://cad.3d66.com/" } }],
  ["wrong API model", { info: { sof: "AJI89635771994629725" } }], ["wrong API type", { info: { res_type: 1 } }],
  ["deleted API model", { info: { is_delete: 1 } }], ["changed price", { info: { res_price: 29 } }],
  ["missing DOM price", { document: { price: null }, info: { res_price: 0 } }],
  ["missing API price", { document: { price: 0 }, info: { res_price: null } }],
  ["empty API price", { document: { price: 0 }, info: { res_price: "" } }],
  ["rejected API code with success status", { popStatus: { code: 0 } }],
  ["DOM navigation race", { changed: true }],
]) {
  test(`CAD verification rejects ${label} without any purchase`, async () => {
    const state = fixture(options);
    await assert.rejects(state.run(), error => error.code === "THREED66_CLEAN_LINK_REQUIRED");
    assert.ok(state.calls.every(endpoint => endpoint.endsWith("/info") || endpoint.endsWith("/pop")));
  });
}
