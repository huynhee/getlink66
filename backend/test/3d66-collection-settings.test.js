import test, { after } from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const env = {
  ADMIN_EMAILS: "admin@example.test",
  THREED66_MODEL_RESOLVE_MODE: "collection",
  THREED66_COLLECTION_ID: "123456",
  THREED66_COLLECTION_USER: "ACJ00000001",
  THREED66_REQUIRED_ACCOUNT_MARKER: "89635771",
};
const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const { getSettings, updateSettings, initializeSettings } = await import("../src/controllers/settingsController.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const admin = { role: "admin", email: "admin@example.test", isTwoFactorEnabled: true };
const collection = { threed66ModelResolveMode: "collection", threed66CollectionId: "234567", threed66CollectionUser: "ACJ00000002" };

async function reset(values = {}) {
  await SiteSetting.deleteMany({});
  await SiteSetting.create({ key: "homepage", threed66ModelResolveMode: "search",
    threed66CollectionId: "", threed66CollectionUser: "", ...values });
}

async function request(handler, body, auth = { user: admin, jwtPayload: { is2FAVerified: true } }) {
  let result;
  let status = 200;
  await handler({ body, ...auth }, {
    status(code) { status = code; return this; },
    json(value) { result = value; return value; },
  }, (error) => { throw error; });
  return { status, ...result };
}

test("legacy missing settings inherit collection env without resetting it to search", async () => {
  await SiteSetting.deleteMany({});
  await SiteSetting.create({ key: "homepage" });
  await initializeSettings();
  const stored = await SiteSetting.findOne({ key: "homepage" });
  assert.equal(stored.threed66ModelResolveMode, "collection");
  assert.equal(stored.threed66CollectionId, env.THREED66_COLLECTION_ID);
  assert.equal(stored.threed66CollectionUser, env.THREED66_COLLECTION_USER);
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "collection");
});

test("admin saves the complete collection configuration and reapplies it without restart", async () => {
  await reset();
  const saved = await request(updateSettings, { ...collection, threed66CollectionId: " 234567 ", threed66CollectionUser: " ACJ00000002 " });
  assert.equal(saved.status, 200);
  assert.equal(saved.settings.threed66CollectionId, collection.threed66CollectionId);
  assert.equal(saved.settings.threed66CollectionUser, collection.threed66CollectionUser);
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "collection");
  assert.equal(process.env.THREED66_COLLECTION_ID, collection.threed66CollectionId);
  assert.equal(process.env.THREED66_COLLECTION_USER, collection.threed66CollectionUser);
  assert.equal(process.env.THREED66_REQUIRED_ACCOUNT_MARKER, env.THREED66_REQUIRED_ACCOUNT_MARKER);
  process.env.THREED66_MODEL_RESOLVE_MODE = "search";
  process.env.THREED66_COLLECTION_ID = "999999";
  await initializeSettings();
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "collection");
  assert.equal(process.env.THREED66_COLLECTION_ID, collection.threed66CollectionId);
});

test("collection details remain private while public clients receive the input mode", async () => {
  await reset(collection);
  for (const auth of [{ user: null }, { user: { ...admin, role: "user" } }, { user: admin },
    { user: { ...admin, email: "other@example.test" }, jwtPayload: { is2FAVerified: true } }]) {
    const result = await request(getSettings, undefined, auth);
    assert.equal(result.settings.threed66ModelResolveMode, "collection");
    assert.equal(Object.hasOwn(result.settings, "threed66CollectionId"), false);
    assert.equal(Object.hasOwn(result.settings, "threed66CollectionUser"), false);
  }
  const result = await request(getSettings);
  assert.equal(result.settings.threed66CollectionId, collection.threed66CollectionId);
  assert.equal(result.settings.threed66CollectionUser, collection.threed66CollectionUser);
});

test("collection cannot be enabled without both fields and rejected updates do not change mode or content", async () => {
  await reset({ heroText: "Existing text" });
  const rejected = await request(updateSettings, { threed66ModelResolveMode: "collection", heroText: "Rejected text" });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.code, "INVALID_THREED66_COLLECTION_CONFIG");
  const stored = await SiteSetting.findOne({ key: "homepage" });
  assert.equal(stored.threed66ModelResolveMode, "search");
  assert.equal(stored.heroText, "Existing text");
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "search");
});

for (const invalid of [
  { threed66CollectionId: '1"]', threed66CollectionUser: "ACJ00000002" },
  { threed66CollectionId: 234567, threed66CollectionUser: "ACJ00000002" },
  { threed66CollectionId: "0", threed66CollectionUser: "ACJ00000002" },
  { threed66CollectionId: "234567", threed66CollectionUser: "https://evil.test" },
  { threed66CollectionId: "234567", threed66CollectionUser: { value: "ACJ00000002" } },
]) {
  test(`invalid collection settings cannot be saved: ${JSON.stringify(invalid)}`, async () => {
    await reset(collection);
    const result = await request(updateSettings, invalid);
    assert.equal(result.status, 400);
    assert.equal(result.code, "INVALID_THREED66_COLLECTION_CONFIG");
    const stored = await SiteSetting.findOne({ key: "homepage" });
    assert.equal(stored.threed66CollectionId, collection.threed66CollectionId);
    assert.equal(stored.threed66CollectionUser, collection.threed66CollectionUser);
  });
}

test("an active collection cannot lose its configuration through a partial update", async () => {
  await reset(collection);
  const result = await request(updateSettings, { threed66CollectionId: "" });
  assert.equal(result.status, 400);
  assert.equal((await SiteSetting.findOne({ key: "homepage" })).threed66CollectionId, collection.threed66CollectionId);
});

test("partial collection changes write a complete validated configuration snapshot", async (t) => {
  await reset(collection);
  const updates = [];
  const original = SiteSetting.findOneAndUpdate;
  t.mock.method(SiteSetting, "findOneAndUpdate", async (...args) => {
    updates.push(args[1].$set);
    return original(...args);
  });
  const result = await request(updateSettings, { threed66CollectionUser: "ACJ00000003" });
  assert.equal(result.status, 200);
  const update = updates.find((value) => value.threed66CollectionUser === "ACJ00000003");
  assert.equal(update.threed66ModelResolveMode, "collection");
  assert.equal(update.threed66CollectionId, collection.threed66CollectionId);
});

test("switching off collection permits explicit clearing without restoring env defaults", async () => {
  await reset(collection);
  const result = await request(updateSettings, { threed66ModelResolveMode: "search", threed66CollectionId: "", threed66CollectionUser: "" });
  assert.equal(result.status, 200);
  await initializeSettings();
  assert.equal(process.env.THREED66_COLLECTION_ID, "");
  assert.equal(process.env.THREED66_COLLECTION_USER, "");
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "search");
});

test("a typo in the selected mode is rejected instead of silently switching to search", async () => {
  await reset(collection);
  const result = await request(updateSettings, { threed66ModelResolveMode: "colletion" });
  assert.equal(result.status, 400);
  assert.equal(result.code, "INVALID_THREED66_RESOLVE_MODE");
  assert.equal((await SiteSetting.findOne({ key: "homepage" })).threed66ModelResolveMode, "collection");
});
