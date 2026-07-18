import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { getSettings } = await import("../src/controllers/settingsController.js");

test("guest settings only expose landing-page fields and input mode", async () => {
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
});
