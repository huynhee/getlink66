import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { assert3D66CleanModelUrl, required3D66AccountMarker } from "../src/utils/3d66CleanLink.js";
import { build3D66FootprintSeed } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { normalizeAccountModelId } from "../src/utils/parse3d66.js";

useMemoryDb();
const env = { ADMIN_EMAILS: "marker-admin@example.test", THREED66_REQUIRED_ACCOUNT_MARKER: "87654321",
  THREED66_ACCOUNT_MARKER: "99999999", THREED66_MODEL_RESOLVE_MODE: "search" };
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
const admin = { role: "admin", email: env.ADMIN_EMAILS, isTwoFactorEnabled: true };
const auth = { user: admin, jwtPayload: { is2FAVerified: true } };
const markerField = "threed66RequiredAccountMarker";
const source = "https://3d.3d66.com/reshtmla/model/items/fixture/marker.html?sof=GCI139810814629725&sign=old-fixture";

beforeEach(async () => {
  Object.assign(process.env, env);
  await SiteSetting.deleteMany({});
});

async function request(handler, body, authorization = auth) {
  let payload;
  let status = 200;
  await handler({ body, ...authorization }, {
    json(value) { payload = value; return value; },
    status(value) { status = value; return this; },
  }, (error) => { throw error; });
  return { status, ...payload };
}

test("existing settings inherit the required env marker without replacing it with search or a hardcoded ID", async () => {
  await SiteSetting.create({ key: "homepage" });
  await initializeSettings();
  const stored = await SiteSetting.findOne({ key: "homepage" });
  assert.equal(stored[markerField], env.THREED66_REQUIRED_ACCOUNT_MARKER);
  assert.equal(required3D66AccountMarker(), "87654321");
  assert.equal(process.env.THREED66_ACCOUNT_MARKER, "87654321");
});

test("new settings capture the configured marker on first initialization", async () => {
  await initializeSettings();
  assert.equal((await SiteSetting.findOne({ key: "homepage" }))[markerField], "87654321");
});

test("admin changes rewriting, search and signature validation together and the value survives restart", async () => {
  const saved = await request(updateSettings, { [markerField]: " 00123456 ", threed66ModelResolveMode: "rewritten_footprint" });
  assert.equal(saved.status, 200);
  assert.equal(saved.settings[markerField], "00123456");
  const seed = build3D66FootprintSeed(source);
  assert.equal(seed.productId, "ACI001234564629725");
  assert.equal(normalizeAccountModelId("GCI139810814629725"), "GCI001234564629725");
  assert.equal(assert3D66CleanModelUrl(`${seed.modelPage}?sof=${seed.productId}&sign=signed-fixture`), seed.productId);
  assert.throws(() => assert3D66CleanModelUrl(`${seed.modelPage}?sof=ACI876543214629725&sign=old-fixture`),
    { code: "THREED66_CLEAN_LINK_REQUIRED" });
  Object.assign(process.env, env);
  await initializeSettings();
  assert.equal(required3D66AccountMarker(), "00123456");
  assert.equal(process.env.THREED66_ACCOUNT_MARKER, "00123456");
  assert.equal(process.env.THREED66_MODEL_RESOLVE_MODE, "rewritten_footprint");
});

test("partial mode updates retain the marker in the same atomic settings write", async (t) => {
  await SiteSetting.create({ key: "homepage", [markerField]: "123456789", threed66ModelResolveMode: "search" });
  const updates = [];
  const original = SiteSetting.findOneAndUpdate;
  t.mock.method(SiteSetting, "findOneAndUpdate", async (...args) => {
    updates.push(args[1].$set);
    return original(...args);
  });
  const result = await request(updateSettings, { threed66ModelResolveMode: "rewritten_footprint" });
  assert.equal(result.status, 200);
  const snapshot = updates.find((value) => value.threed66ModelResolveMode === "rewritten_footprint");
  assert.equal(snapshot[markerField], "123456789");
  assert.equal(required3D66AccountMarker(), "123456789");
});

for (const value of ["", "  ", "12345", "1234567890123", "123456#comment", "123456a", "12 345678", 12345678, null, {}, ["12345678"]]) {
  test(`invalid marker rejects the entire update without changing settings or the guard (${JSON.stringify(value)})`, async () => {
    await SiteSetting.create({ key: "homepage", [markerField]: "87654321", heroText: "Original" });
    const result = await request(updateSettings, { [markerField]: value, heroText: "Rejected" });
    assert.equal(result.status, 400);
    assert.equal(result.code, "INVALID_THREED66_ACCOUNT_MARKER");
    const stored = await SiteSetting.findOne({ key: "homepage" });
    assert.equal(stored[markerField], "87654321");
    assert.equal(stored.heroText, "Original");
    assert.equal(required3D66AccountMarker(), "87654321");
    assert.equal(process.env.THREED66_ACCOUNT_MARKER, env.THREED66_ACCOUNT_MARKER);
  });
}

test("account marker stays private to verified admins", async () => {
  await SiteSetting.create({ key: "homepage", [markerField]: "00123456" });
  for (const authorization of [{ user: null }, { user: { ...admin, role: "user" } }, { user: admin },
    { user: { ...admin, email: "unlisted@example.test" }, jwtPayload: { is2FAVerified: true } }]) {
    const result = await request(getSettings, undefined, authorization);
    assert.equal(Object.hasOwn(result.settings, markerField), false);
  }
  assert.equal((await request(getSettings)).settings[markerField], "00123456");
});
