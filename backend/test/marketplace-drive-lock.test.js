import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: State } = await import("../src/models/MarketplaceDriveSyncState.js");
const {
  runMarketplaceDriveSyncOnce,
  startMarketplaceDriveSyncJob,
  stopMarketplaceDriveSyncJob
} = await import("../src/utils/marketplaceDriveSyncJob.js");

test("failed Drive lock claims never overwrite the owner's running state", async (t) => {
  const updates = [];
  t.mock.method(State, "findOne", () => ({ select: () => ({ lean: async () => ({ migrationStatus: "idle" }) }) }));
  t.mock.method(State, "findOneAndUpdate", async (...args) => {
    updates.push(args);
    return null;
  });
  t.mock.method(State, "create", async () => {
    throw Object.assign(new Error("Duplicate root"), { code: 11000 });
  });

  // Repeated conflicts must also release the process-local flag, not the DB lock.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(runMarketplaceDriveSyncOnce({ rootFolderId: "busy-root" }), { status: 409 });
  }
  assert.equal(updates.length, 2);
  assert.ok(updates.every(([, update]) => update.$set.status === "running"));
  assert.ok(updates.every(([filter]) => filter.$or));
});

test("database errors while claiming Drive locks preserve the existing state", async (t) => {
  let calls = 0;
  t.mock.method(State, "findOne", () => ({ select: () => ({ lean: async () => ({}) }) }));
  t.mock.method(State, "findOneAndUpdate", async () => {
    calls += 1;
    throw new Error("Database unavailable");
  });
  await assert.rejects(runMarketplaceDriveSyncOnce({ rootFolderId: "unreachable-root" }), /Database unavailable/);
  assert.equal(calls, 1);
});

test("scheduled Drive cycles do not overlap and resume after a busy-owner conflict", async (t) => {
  const keys = ["MARKETPLACE_DRIVE_CHANGES_ENABLED", "MARKETPLACE_DRIVE_ROOT_FOLDER_ID", "SCENES_DRIVE_ROOT_FOLDER_ID"];
  const saved = keys.map((key) => process.env[key]);
  process.env.MARKETPLACE_DRIVE_CHANGES_ENABLED = "true";
  process.env.MARKETPLACE_DRIVE_ROOT_FOLDER_ID = "scheduled-root";
  delete process.env.SCENES_DRIVE_ROOT_FOLDER_ID;
  t.after(() => {
    stopMarketplaceDriveSyncJob();
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  });
  let tick;
  const timer = { unref() {} };
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return timer; });
  t.mock.method(globalThis, "setTimeout", () => timer);
  t.mock.method(globalThis, "clearInterval", () => {});
  t.mock.method(globalThis, "clearTimeout", () => {});
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let cycles = 0;
  t.mock.method(State, "findOne", () => ({
    select: (fields) => ({ lean: async () => {
      if (fields === "migrationStatus") {
        cycles += 1;
        await gate;
      }
      return {};
    } })
  }));
  t.mock.method(State, "findOneAndUpdate", async () => null);
  t.mock.method(State, "create", async () => {
    throw Object.assign(new Error("Duplicate root"), { code: 11000 });
  });
  startMarketplaceDriveSyncJob();
  tick();
  tick();
  assert.equal(cycles, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cycles, 2);
});
