import assert from "node:assert/strict";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: User } = await import("../src/models/User.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: ProductCache } = await import("../src/models/ProductCache.js");
const { getLink, prepareRedownload, downloadGetlink } = await import("../src/controllers/getlinkController.js");
const foreignId = "BCH01077971442400";
const dirtySource = `https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=${foreignId}&sign=fixture`;

async function fixture(t, name) {
  const before = process.env.THREED66_MOCK;
  process.env.THREED66_MOCK = "false";
  t.after(() => {
    if (before === undefined) delete process.env.THREED66_MOCK;
    else process.env.THREED66_MOCK = before;
  });
  const user = await User.create({ email: `${name}@example.test`, credit: 100 });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; assert.fail("No upstream request allowed"); });
  return { user, calls: () => calls };
}

function request(user, body = {}, params = {}) {
  return {
    user, body, params, query: {}, protocol: "https", ip: "127.0.0.1", path: "/fixture",
    get: () => "", isAuthenticated: () => true,
  };
}

function response() {
  return {
    on() {}, status() { return this; },
    json() { assert.fail("A rejected clean link cannot return a download URL"); },
  };
}

test("a dirty purchased cache stops before credit debit, fresh resolution, or history creation", async (t) => {
  const { user, calls } = await fixture(t, "clean-cache");
  const cache = await ProductCache.create({
    productId: foreignId, fileUrl: "https://download.3d66.com/fixture.zip",
    sourceUrl: dirtySource, resolvedSourceUrl: dirtySource, title: "Fixture model", creditCost: 28,
    priceKnown: true, isPurchased: true,
  });
  t.after(() => ProductCache.deleteMany({ _id: cache._id }));
  let failure;
  await getLink(request(user, { url: dirtySource }), response(), (error) => { failure = error; });
  assert.equal(failure?.code, "THREED66_CLEAN_LINK_REQUIRED");
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await Getlink.countDocuments({ userId: user._id }), 0);
  assert.equal((await ProductCache.findById(cache._id)).resolvedSourceUrl, dirtySource);
  assert.equal(calls(), 0);
});

for (const [name, controller] of [["prepare", prepareRedownload], ["stream", downloadGetlink]]) {
  test(`dirty paid history is blocked before ${name}, without using another cookie or download quota`, async (t) => {
    const { user, calls } = await fixture(t, `clean-history-${name}`);
    const history = await Getlink.create({
      userId: user._id, productId: foreignId, fileUrl: "https://download.3d66.com/fixture.zip",
      sourceUrl: dirtySource, resolvedSourceUrl: dirtySource, creditUsed: 28, redownloadCount: 0,
    });
    let failure;
    await controller(request(user, {}, { id: String(history._id) }), response(), (error) => { failure = error; });
    assert.equal(failure?.code, "THREED66_CLEAN_LINK_REQUIRED");
    const after = await Getlink.findById(history._id);
    assert.equal(after.redownloadCount, 0);
    assert.equal(after.initialDownloadAt, undefined);
    assert.equal(after.fileUrl, history.fileUrl);
    assert.equal((await User.findById(user._id)).credit, 100);
    assert.equal(calls(), 0);
  });
}
