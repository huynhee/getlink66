import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { create3D66BrowserProfileStore } from "../src/utils/3d66BrowserProfileStore.js";
import { create3D66BrowserSessionPool } from "../src/utils/3d66BrowserSessionPool.js";
import { get3D66BrowserContextOptions, get3D66BrowserLaunchOptions } from "../src/utils/3d66BrowserService.js";

const mode = process.argv[2];
const root = process.argv[3];
assert.ok(["write", "read"].includes(mode) && root && path.isAbsolute(root), "Use write|read and an isolated absolute fixture directory");
const key = "c".repeat(64);
const store = create3D66BrowserProfileStore({ directory: path.join(root, "fixture-profiles") });
const pool = create3D66BrowserSessionPool({ stateStore: store });
const browser = await chromium.launch(get3D66BrowserLaunchOptions());
let opened = 0;
try {
  const lease = await pool.acquire(key, async storageState => {
    assert.equal(Boolean(storageState), mode === "read");
    const context = await browser.newContext({ ...get3D66BrowserContextOptions(), ...(storageState ? { storageState } : {}) });
    context.on("page", () => { opened++; });
    // No request reaches a source site, including during this headed Linux test.
    await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html",
      body: "<!doctype html><style>body{background:#fff;color:#171717;font:28px sans-serif;padding:48px}h1{color:#008b60}</style><h1>Local headed browser fixture</h1><p>No CAPTCHA or real account is accessed.</p>" }));
    return context;
  });
  const page = await lease.context.newPage();
  await page.goto("https://www.3d66.com/fixture/durable-session");
  if (mode === "write") {
    await lease.context.addCookies([{ name: "fixture-persistent-login", value: "fixture-session-cookie", url: "https://www.3d66.com" }]);
    await page.evaluate(() => globalThis.localStorage.setItem("fixture-preference", "remembered-across-processes"));
  } else {
    assert.equal((await lease.context.cookies()).find(item => item.name === "fixture-persistent-login")?.value, "fixture-session-cookie");
    assert.equal(await page.evaluate(() => globalThis.localStorage.getItem("fixture-preference")), "remembered-across-processes");
    await page.screenshot({ path: path.join(root, "headed-fixture.png") });
  }
  await lease.release();
  assert.equal(opened, 1, "Saving state must not open auxiliary tabs");
  const encoded = await fs.readFile(path.join(root, "fixture-profiles", `${key}.enc`), "utf8");
  assert.ok(encoded.startsWith("enc:v1:") && !encoded.includes("fixture-session-cookie"));
  console.log(JSON.stringify({ ok: true, mode, headless: get3D66BrowserLaunchOptions().headless,
    browser: browser.version(), opened, fixtureOnly: true }));
} finally {
  await pool.closeAll();
  await browser.close();
}
