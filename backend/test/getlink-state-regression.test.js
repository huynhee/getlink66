import assert from "node:assert/strict";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { encryptSecret } from "../src/utils/secretBox.js";
import { restoreGetlinkDraft, getlinkRequestId } from "../../frontend/src/utils/getlinkDraft.js";

useMemoryDb();
const { default: Cookie } = await import("../src/models/Cookie.js");
const { default: ProductCache } = await import("../src/models/ProductCache.js");
const { resolveProductCache } = await import("../src/controllers/getlinkController.js");
const { getUsable3D66Cookies, mark3D66CookieSuccess, mark3D66CookieFailure } = await import("../src/utils/3d66CookiePool.js");
const cookieValue = "PHPSESSID=audit-fixture; login_sign=audit-fixture";

async function cookieFixture(t) {
  await Cookie.deleteMany({});
  const row = await Cookie.create({ value: encryptSecret(cookieValue), isActive: true, status: "active" });
  t.after(() => Cookie.deleteMany({}));
  return row;
}

test("disabled cookies cannot be selected even if isActive is still true", async (t) => {
  const row = await cookieFixture(t);
  await Cookie.findByIdAndUpdate(row._id, { status: "disabled" });
  assert.equal((await getUsable3D66Cookies()).length, 0);
});

for (const outcome of ["success", "failure"]) {
  for (const change of ["disable", "replace"]) {
    test(`late ${outcome} cannot overwrite a cookie after admin ${change}`, async (t) => {
      const row = await cookieFixture(t);
      const [selected] = await getUsable3D66Cookies();
      const patch = change === "disable" ? { status: "disabled", isActive: false }
        : { value: encryptSecret("PHPSESSID=new-fixture; login_sign=new-fixture"), status: "warning" };
      await Cookie.findByIdAndUpdate(row._id, { ...patch, failureCount: 7 });
      if (outcome === "success") await mark3D66CookieSuccess(selected);
      else await mark3D66CookieFailure(selected, { message: "fixture expired", status: 401 });
      const after = await Cookie.findById(row._id);
      assert.equal(after.failureCount, 7);
      for (const [key, value] of Object.entries(patch)) assert.equal(after[key], value);
    });
  }
}

test("unchanged encrypted cookie health can still be updated", async (t) => {
  const row = await cookieFixture(t);
  const [selected] = await getUsable3D66Cookies();
  await mark3D66CookieSuccess(selected);
  assert.equal((await Cookie.findById(row._id)).useCount, 1);
});

test("concurrent format requests never share a different renderer's result", async (t) => {
  await cookieFixture(t);
  const before = { THREED66_MOCK: process.env.THREED66_MOCK, THREED66_REQUEST_INTERVAL_MS: process.env.THREED66_REQUEST_INTERVAL_MS };
  Object.assign(process.env, { THREED66_MOCK: "true", THREED66_REQUEST_INTERVAL_MS: "0" });
  t.after(() => { for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  t.mock.method(globalThis, "fetch", () => assert.fail("Only mocked downloads are allowed"));
  await ProductCache.deleteMany({});
  const source = "https://3d.3d66.com/reshtmla/model/items/fixture/concurrent.html?sof=ACI896357714629725&sign=fixture";
  const vr = { key: "1|2014|4", fileFormat: "1", formatVersion: "2014", rendererType: "4" };
  const cr = { key: "1|max2016|3", fileFormat: "1", formatVersion: "max2016", rendererType: "3" };
  const [first, second] = await Promise.all([
    resolveProductCache("ACI896357714629725", source, vr),
    resolveProductCache("ACI896357714629725", source, cr),
  ]);
  assert.equal(first.downloadFormatKey, vr.key);
  assert.equal(second.downloadFormatKey, cr.key);
  await ProductCache.deleteMany({});
  const [sameA, sameB] = await Promise.all([
    resolveProductCache("ACI896357714629725", source, cr),
    resolveProductCache("ACI896357714629725", source, cr),
  ]);
  assert.equal(String(sameA._id), String(sameB._id));
  assert.equal((await Cookie.findOne({})).useCount, 3);
});

test("preview draft is bound to URL, mode and a short original expiry", () => {
  const stored = { url: "fixture-link", previewUrl: "fixture-link", resolveMode: "direct",
    preview: { title: "Old model" }, previewCheckedAt: 1000, selectedFormatKey: "1|2014|4" };
  assert.equal(restoreGetlinkDraft(stored, { resolveMode: "direct", now: 2000 }).preview.title, "Old model");
  for (const options of [{ resolveMode: "direct", now: 31_000 }, { resolveMode: "direct", now: 500 },
    { resolveMode: "collection", now: 2000 }, { resolveMode: "direct", now: 2000, initialUrl: "new-link" }]) {
    const result = restoreGetlinkDraft(stored, options);
    assert.equal(result.preview, null);
    assert.equal(result.selectedFormatKey, "");
  }
  assert.equal(restoreGetlinkDraft({ ...stored, previewCheckedAt: undefined }, { resolveMode: "direct" }).preview, null);
});

test("request IDs are reused only for the same model, format and preview option", () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  let count = 0;
  const id = () => `request_${++count}`;
  const payload = { modelId: "first-model", downloadFormat: { key: "1|2014|4" } };
  const first = getlinkRequestId(storage, "request", payload, id);
  assert.equal(getlinkRequestId(storage, "request", payload, id), first);
  for (const changed of [{ ...payload, modelId: "next-model" }, { ...payload, includePreviewImage: true },
    { ...payload, downloadFormat: { key: "1|max2016|3" } }]) {
    assert.notEqual(getlinkRequestId(storage, "request", changed, id), first);
  }
  storage.setItem("request", "old-unbound-id");
  assert.notEqual(getlinkRequestId(storage, "request", payload, id), "old-unbound-id");
});
