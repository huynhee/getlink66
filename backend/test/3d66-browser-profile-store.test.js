import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { create3D66BrowserProfileStore } from "../src/utils/3d66BrowserProfileStore.js";
import { create3D66BrowserSessionPool } from "../src/utils/3d66BrowserSessionPool.js";
import { encryptSecret } from "../src/utils/secretBox.js";

const key = "a".repeat(64);
const otherKey = "b".repeat(64);
const state = { cookies: [{ name: "PHPSESSID", value: "fixture-private-cookie", domain: ".3d66.com", path: "/", expires: -1 }],
  origins: [{ origin: "https://www.3d66.com", localStorage: [{ name: "fixture-preference", value: "fixture-private-preference" }] }] };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-browser-profile-"));
  const oldKey = process.env.COOKIE_ENCRYPTION_KEY;
  process.env.COOKIE_ENCRYPTION_KEY = "fixture-browser-profile-key-at-least-32-characters";
  t.after(async () => {
    if (oldKey === undefined) delete process.env.COOKIE_ENCRYPTION_KEY;
    else process.env.COOKIE_ENCRYPTION_KEY = oldKey;
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("3dipl-browser-profile-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const events = [];
  const options = { directory: path.join(root, "profiles"), report: code => events.push(code) };
  return { root, directory: options.directory, store: create3D66BrowserProfileStore(options), options, events };
}

test("a fresh process/store restores encrypted cookies and localStorage with private file permissions", async t => {
  const { store, directory, options } = await fixture(t);
  assert.equal(await store.load(key), null);
  await store.save(key, state);
  const raw = await fs.readFile(path.join(directory, `${key}.enc`), "utf8");
  assert.ok(raw.startsWith("enc:v1:"));
  assert.equal(raw.includes("fixture-private"), false);
  assert.deepEqual(await create3D66BrowserProfileStore(options).load(key), state);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(directory, `${key}.enc`))).mode & 0o777, 0o600);
  }
});

test("profile keys, credentials and directories remain isolated", async t => {
  const { store, options } = await fixture(t);
  await store.save(key, state);
  assert.equal(await store.load(otherKey), null);
  const other = create3D66BrowserProfileStore({ ...options, directory: options.directory + "-other" });
  assert.equal(await other.load(key), null);
  await assert.rejects(store.save("../escape", state), { code: "THREED66_PROFILE_SAVE_FAILED" });
});

test("renamed, plaintext, corrupt or oversized profiles fail closed without deleting saved files", async t => {
  const { store, directory } = await fixture(t);
  await store.save(key, state);
  const file = path.join(directory, `${otherKey}.enc`);
  await fs.copyFile(path.join(directory, `${key}.enc`), file);
  await fs.chmod(file, 0o600);
  await assert.rejects(store.load(otherKey), { code: "THREED66_PROFILE_LOAD_FAILED" });
  for (const value of [JSON.stringify(state), "enc:v1:broken", "x".repeat(2 * 1024 * 1024 + 1)]) {
    await fs.writeFile(file, value, { mode: 0o600 });
    await assert.rejects(store.load(otherKey), { code: "THREED66_PROFILE_LOAD_FAILED" });
    assert.equal(await fs.readFile(file, "utf8"), value);
  }
});

test("cross-domain state and a wrong encryption key are rejected", async t => {
  const { store, directory } = await fixture(t);
  const bad = { ...state, origins: [{ origin: "https://evil3d66.com", localStorage: [] }] };
  await assert.rejects(store.save(key, bad), { code: "THREED66_PROFILE_SAVE_FAILED" });
  await store.save(key, state);
  const file = path.join(directory, `${key}.enc`);
  await fs.writeFile(file, encryptSecret(JSON.stringify({ version: 1, key, state: bad })), { mode: 0o600 });
  await assert.rejects(store.load(key), { code: "THREED66_PROFILE_LOAD_FAILED" });
  await store.save(key, state);
  process.env.COOKIE_ENCRYPTION_KEY = "a-different-fixture-key-with-at-least-32-characters";
  await assert.rejects(store.load(key), { code: "THREED66_PROFILE_LOAD_FAILED" });
});

test("concurrent saves are atomic and later snapshots win without leaving temporary files", async t => {
  const { store, directory } = await fixture(t);
  const next = { ...state, cookies: [{ ...state.cookies[0], value: "new-fixture" }] };
  const first = store.save(key, state);
  const second = store.save(key, next);
  await first;
  await second;
  assert.deepEqual(await store.load(key), next);
  assert.deepEqual(await fs.readdir(directory), [`${key}.enc`]);
});

test("disabled persistence does not create a directory or retain data", async () => {
  const store = create3D66BrowserProfileStore({ directory: "" });
  assert.equal(store.enabled(), false);
  await store.save(key, state);
  assert.equal(await store.load(key), null);
});

test("symlinked profile directories cannot redirect private writes", async t => {
  const { root, options } = await fixture(t);
  const target = path.join(root, "target");
  await fs.mkdir(target);
  await fs.symlink(target, options.directory, process.platform === "win32" ? "junction" : "dir");
  const store = create3D66BrowserProfileStore(options);
  await assert.rejects(store.save(key, state), { code: "THREED66_PROFILE_SAVE_FAILED" });
  assert.deepEqual(await fs.readdir(target), []);
});

test("a fresh session pool restores durable state after the first pool is shut down", async t => {
  const { store, options } = await fixture(t);
  const context = { pages: () => [{ frames: () => [{ url: () => state.origins[0].origin,
    evaluate: async () => state.origins[0].localStorage }] }], cookies: async () => state.cookies,
    async close() {}, async route() {}, async unroute() {} };
  const first = create3D66BrowserSessionPool({ stateStore: store });
  const lease = await first.acquire(key, async () => context);
  await lease.release();
  await first.closeAll();
  const second = create3D66BrowserSessionPool({ stateStore: create3D66BrowserProfileStore(options) });
  t.after(() => second.closeAll());
  const restored = await second.acquire(key, async saved => { assert.deepEqual(saved, state); return context; });
  assert.equal(restored.restored, true);
  await restored.release();
});

test("persistence errors do not fail completed work, but explicit verification save can require durability", async () => {
  const stateStore = { async load() { return null; }, async save() { throw new Error("fixture I/O failure"); } };
  const pool = create3D66BrowserSessionPool({ stateStore });
  const context = { pages: () => [], cookies: async () => state.cookies, async close() {}, async route() {}, async unroute() {} };
  const lease = await pool.acquire(key, async () => context);
  await assert.doesNotReject(lease.release());
  await assert.rejects(pool.remember(key, context, { required: true }), { code: "THREED66_VERIFICATION_SESSION" });
  await pool.closeAll();
});

test("a timed-out snapshot cannot overwrite a newer durable profile", async () => {
  let finishOld;
  let calls = 0;
  let saved;
  const frame = { url: () => state.origins[0].origin, evaluate: async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finishOld = resolve; });
    return [{ name: "version", value: "new" }];
  } };
  const context = { pages: () => [{ frames: () => [frame] }], cookies: async () => state.cookies };
  const pool = create3D66BrowserSessionPool({ snapshotTimeoutMs: 10,
    stateStore: { async save(_key, value) { saved = value; } } });
  await pool.remember(key, context);
  await pool.remember(key, context);
  finishOld([{ name: "version", value: "old" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.origins[0].localStorage[0].value, "new");
  await pool.closeAll();
});
