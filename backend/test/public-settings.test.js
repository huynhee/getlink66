import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { getSettings } = await import("../src/controllers/settingsController.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");

test("guest settings only expose landing-page fields and input mode", async () => {
  await SiteSetting.create({
    key: "homepage",
    heroText: "TAI MODEL 3D66",
    heroSubtitle: "Dich vu getlink 3D66",
    heroEyebrow: "+ api 3d66 sdk",
  });
  let payload;
  await getSettings(
    { user: null },
    { json(value) { payload = value; } },
    (error) => { throw error; },
  );

  assert.equal(typeof payload.settings.heroText, "string");
  assert.equal(typeof payload.settings.threed66ModelResolveMode, "string");
  assert.equal(Object.hasOwn(payload.settings, "threed66TimeoutMs"), false);
  assert.equal(Object.hasOwn(payload.settings, "threed66ProxyEnabled"), false);
  assert.equal(Object.hasOwn(payload.settings, "_id"), false);
  assert.equal(payload.settings.heroText, "TAI MODEL 3D");
  assert.equal(payload.settings.heroSubtitle, "Dich vu getlink 3D");
  assert.equal(payload.settings.heroEyebrow, "+ api 3D sdk");

  const stored = await SiteSetting.findOne({ key: "homepage" });
  assert.equal(stored.heroText, "TAI MODEL 3D");
  assert.equal(stored.heroSubtitle, "Dich vu getlink 3D");
});
