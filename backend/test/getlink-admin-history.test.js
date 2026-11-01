import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: ProductCache } = await import("../src/models/ProductCache.js");
const { default: User } = await import("../src/models/User.js");
const { listGetlinkRecords } = await import("../src/controllers/adminController.js");

beforeEach(async () => {
  await Getlink.deleteMany({});
  await ProductCache.deleteMany({});
  await User.deleteMany({});
});

async function adminHistory(query = {}) {
  let payload;
  await listGetlinkRecords({ query }, { json(value) { payload = JSON.parse(JSON.stringify(value)); } }, (error) => { throw error; });
  return payload.getlinks;
}

test("admin Getlink history exposes retained page links, not the private file URL", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Audit reads must not resolve or download model links"); });
  const user = await User.create({ name: "Audit fixture", email: "getlink-audit@example.test", credit: 100 });
  const links = {
    sourceUrl: "https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=original&sign=fixture",
    resolvedSourceUrl: "https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=resolved&sign=fixture"
  };
  await Getlink.create({ userId: user._id, productId: "audit-retained", ...links, creditUsed: 28,
    detailsPurgedAt: new Date("2026-10-20T00:00:00Z") });
  await Getlink.create({ userId: user._id, productId: "audit-recent", ...links, creditUsed: 28,
    fileUrl: "https://download.3d66.com/private.zip" });
  const records = await adminHistory();
  assert.equal(records.length, 2);
  for (const item of records) {
    assert.equal(item.user.email, user.email);
    assert.equal(item.sourceUrl, links.sourceUrl);
    assert.equal(item.resolvedSourceUrl, links.resolvedSourceUrl);
    assert.equal(item.creditDeducted, 28);
    assert.equal("fileUrl" in item, false);
  }
  assert.equal(records.find((item) => item.productId === "audit-retained").detailsPurgedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(records.find((item) => item.productId === "audit-recent").detailsPurgedAt, null);
});

test("purged or legacy missing links are never fabricated from a shared product cache", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Missing historical links must not be fetched again"); });
  await ProductCache.create({ productId: "audit-missing", title: "Shared cache title", creditCost: 28,
    sourceUrl: "https://3d.3d66.com/another-user-input",
    resolvedSourceUrl: "https://3d.3d66.com/a-newer-resolution" });
  await Getlink.create({ userId: "audit-user-purged", productId: "audit-missing", creditUsed: 28,
    detailsPurgedAt: new Date("2026-10-20T00:00:00Z") });
  await Getlink.create({ userId: "audit-user-legacy", productId: "audit-missing", creditUsed: 28 });
  const records = await adminHistory();
  for (const item of records) {
    assert.equal(item.title, "Shared cache title");
    assert.equal(item.sourceUrl, "");
    assert.equal(item.resolvedSourceUrl, "");
  }
  assert.equal(records.filter((item) => item.detailsPurgedAt).length, 1);
  assert.equal(records.filter((item) => item.detailsPurgedAt === null).length, 1);
});
