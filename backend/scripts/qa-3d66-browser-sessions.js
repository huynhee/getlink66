import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create3D66BrowserSessionPool } from "../src/utils/3d66BrowserSessionPool.js";
import { create3D66BrowserProfileStore } from "../src/utils/3d66BrowserProfileStore.js";
import { get3D66BrowserContextOptions } from "../src/utils/3d66BrowserService.js";

export async function verify3D66BrowserSessions(browser) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-profile-qa-"));
  const profileOptions = { directory: path.join(root, "profiles") };
  let pool = create3D66BrowserSessionPool({ stateStore: create3D66BrowserProfileStore(profileOptions) });
  const key = "a".repeat(64);
  const contexts = [];
  let opened = 0;
  const create = async storageState => {
    const context = await browser.newContext({ ...get3D66BrowserContextOptions(), ...(storageState ? { storageState } : {}) });
    context.on("page", () => { opened++; });
    // Every request is fulfilled locally; this fixture never contacts 3D66.
    await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html",
      body: "<!doctype html><title>Local browser-session fixture</title><h1>Fixture model</h1>" }));
    contexts.push(context);
    return context;
  };
  try {
    const first = await pool.acquire(key, create);
    const page = await first.context.newPage();
    await page.goto("https://www.3d66.com/fixture/first");
    await page.evaluate(() => globalThis.localStorage.setItem("fixture-renderer", "corona"));
    await first.context.addCookies([{ name: "fixture-session", value: "refreshed", url: "https://www.3d66.com" }]);
    const userAgent = await page.evaluate(() => globalThis.navigator.userAgent);
    const browserMajor = browser.version().split(".")[0];
    assert.ok(userAgent.includes(`Chrome/${browserMajor}.`));
    await first.release();
    assert.equal(opened, 1, "Capturing state must not open utility tabs");
    assert.equal(await page.evaluate(() => fetch("/fixture/idle-network-probe").then(() => true, () => false)), false,
      "Idle contexts must not make background network requests");

    const second = await pool.acquire(key, () => assert.fail("Reuse the same context"));
    await second.activate();
    assert.equal(await page.evaluate(() => globalThis.localStorage.getItem("fixture-renderer")), "corona");
    await second.release();
    assert.equal(opened, 1);
    await pool.closeAll();
    pool = create3D66BrowserSessionPool({ stateStore: create3D66BrowserProfileStore(profileOptions) });

    const restored = await pool.acquire(key, create);
    assert.equal(restored.restored, true, "A fresh manager must restore encrypted state from disk");
    await restored.activate();
    const nextPage = await restored.context.newPage();
    await nextPage.goto("https://www.3d66.com/fixture/second");
    assert.equal(await nextPage.evaluate(() => globalThis.localStorage.getItem("fixture-renderer")), "corona");
    assert.equal((await restored.context.cookies()).find(item => item.name === "fixture-session").value, "refreshed");
    const beforeSnapshot = opened;
    await restored.release();
    assert.equal(opened, beforeSnapshot, "Restored snapshots must not create or focus new tabs");
  } finally {
    await pool.closeAll();
    for (const context of contexts) await context.close().catch(() => {});
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("3dipl-profile-qa-"));
    await fs.rm(root, { recursive: true, force: true });
  }
}
