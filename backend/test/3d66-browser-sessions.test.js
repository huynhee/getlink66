import assert from "node:assert/strict";
import test from "node:test";
import { capture3D66BrowserState, create3D66BrowserSessionPool } from "../src/utils/3d66BrowserSessionPool.js";
import { get3D66BrowserContextOptions, get3D66BrowserLaunchOptions, assertSafe3D66Url, isAllowed3D66BrowserRequestUrl } from "../src/utils/3d66BrowserService.js";

function fixture() {
  const routes = new Set();
  const frame = { url: () => "https://www.3d66.com/", async evaluate() { return [{ name: "fixture", value: "remembered" }]; } };
  let closed = 0;
  const context = { pages: () => [{ frames: () => [frame] }],
    async cookies() { return [{ domain: ".3d66.com", name: "login_sign", value: "updated" }]; },
    async close() { closed++; }, async route(_pattern, handler) { routes.add(handler); },
    async unroute(_pattern, handler) { routes.delete(handler); },
    async storageState() { assert.fail("Snapshots must not create Playwright utility tabs"); },
  };
  return { context, routes, frame, closed: () => closed };
}

test("native context options do not forge browser identity", () => {
  assert.equal(get3D66BrowserLaunchOptions().channel, "chromium");
  assert.equal(get3D66BrowserLaunchOptions().headless, process.env.THREED66_BROWSER_HEADLESS !== "false");
  const options = get3D66BrowserContextOptions();
  assert.equal("userAgent" in options, false);
  assert.equal(options.locale, "zh-CN");
  assert.deepEqual(options.viewport, { width: 1400, height: 800 });
  const proxy = { server: "http://fixture.test:3128" };
  assert.equal(get3D66BrowserContextOptions(proxy).proxy, proxy);
});

test("provider resources are allowed without permitting vendor navigations or lookalike domains", () => {
  for (const host of ["img.alicdn.com", "static.aliyuncs.com", "aliyun.com"]) {
    assert.equal(isAllowed3D66BrowserRequestUrl(`https://${host}/script.js`), true);
    assert.throws(() => assertSafe3D66Url(`https://${host}/`), { status: 400 });
  }
  for (const url of ["https://alicdn.com.evil.test/a", "https://user:pass@img.alicdn.com/a",
    "http://img.alicdn.com/a", "https://img.alicdn.com:8443/a", "http://127.0.0.1/private"]) {
    assert.equal(isAllowed3D66BrowserRequestUrl(url), false);
  }
});

test("snapshot reads only existing source frames and filters third-party state", async () => {
  const { context, frame } = fixture();
  context.pages = () => [{ frames: () => [frame, { url: () => "https://evil.test", evaluate: () => assert.fail("External state") }] }];
  context.cookies = async () => [{ domain: ".3d66.com", name: "a", value: "b" }, { domain: "evil3d66.com", name: "x", value: "y" }];
  const state = await capture3D66BrowserState(context, [{ origin: "https://user.3d66.com", localStorage: [] },
    { origin: "https://evil.test", localStorage: [] }]);
  assert.equal(state.cookies.length, 1);
  assert.deepEqual(state.origins.map(item => item.origin).sort(), ["https://user.3d66.com", "https://www.3d66.com"]);
});

test("same profile reuses the context and idle network guard is removed only when activated", async t => {
  const pool = create3D66BrowserSessionPool();
  t.after(() => pool.closeAll());
  const f = fixture();
  const first = await pool.acquire("cookie-config-a", async () => f.context);
  assert.equal(first.restored, false);
  await first.release();
  assert.equal(f.routes.size, 1);
  const second = await pool.acquire("cookie-config-a", () => assert.fail("Context must be reused"));
  assert.equal(second.context, f.context);
  assert.equal(second.restored, true);
  await second.activate();
  assert.equal(f.routes.size, 0);
  await second.release();
  assert.equal(f.closed(), 0);
});

test("concurrent operations for the same profile are serialized", async t => {
  const pool = create3D66BrowserSessionPool();
  t.after(() => pool.closeAll());
  const f = fixture();
  const first = await pool.acquire("same", async () => f.context);
  let acquired = false;
  const pending = pool.acquire("same", () => assert.fail("No second context")).then(lease => { acquired = true; return lease; });
  await Promise.resolve();
  assert.equal(acquired, false);
  await first.release();
  const second = await pending;
  assert.equal(acquired, true);
  await second.release();
});

test("cookie/configuration keys never share contexts or restored state", async t => {
  const pool = create3D66BrowserSessionPool();
  t.after(() => pool.closeAll());
  const first = await pool.acquire("cookie-a/config-a", async state => { assert.equal(state, null); return fixture().context; });
  await first.release();
  const second = await pool.acquire("cookie-b/config-a", async state => { assert.equal(state, null); return fixture().context; });
  assert.notEqual(first.context, second.context);
  await second.release();
});

test("browser recycling restores updated cookies/localStorage without opening utility pages", async t => {
  const pool = create3D66BrowserSessionPool();
  t.after(() => pool.closeAll());
  const f = fixture();
  const first = await pool.acquire("a", async () => f.context);
  await first.release();
  await pool.closeAll({ preserveState: true });
  assert.equal(f.closed(), 1);
  const next = await pool.acquire("a", async state => {
    assert.equal(state.cookies[0].value, "updated");
    assert.equal(state.origins[0].localStorage[0].value, "remembered");
    return fixture().context;
  });
  assert.equal(next.restored, true);
  await next.release();
});

test("expired state is not restored and idle capacity is bounded", async t => {
  let clock = 1000;
  const pool = create3D66BrowserSessionPool({ now: () => clock, idleMs: 100, stateTtlMs: 200, maxSessions: 1 });
  t.after(() => pool.closeAll());
  const f = fixture();
  const first = await pool.acquire("a", async () => f.context);
  await first.release();
  const second = await pool.acquire("b", async state => { assert.equal(state, null); return fixture().context; });
  assert.equal(f.closed(), 1);
  await second.release();
  clock += 300;
  const third = await pool.acquire("a", async state => { assert.equal(state, null); return fixture().context; });
  await third.release();
});

test("session capacity follows the configured browser concurrency", async t => {
  let capacity = 1;
  const pool = create3D66BrowserSessionPool({ maxSessions: () => capacity });
  t.after(() => pool.closeAll());
  const first = await pool.acquire("a", async () => fixture().context);
  await assert.rejects(pool.acquire("b", () => assert.fail("Capacity must be enforced")), { status: 503 });
  capacity = 2;
  const second = await pool.acquire("b", async () => fixture().context);
  assert.notEqual(first.context, second.context);
  await first.release();
  await second.release();
});

test("detached challenge belongs only to verification; discard never retains a failed context", async t => {
  const pool = create3D66BrowserSessionPool();
  t.after(() => pool.closeAll());
  const f = fixture();
  const first = await pool.acquire("a", async () => f.context);
  await first.release({ detached: true });
  await pool.closeAll();
  assert.equal(f.closed(), 0);
  const second = await pool.acquire("a", async state => { assert.equal(state, null); return f.context; });
  await second.release({ discard: true });
  assert.equal(f.closed(), 1);
});

test("shutdown during context creation closes the late context and cancels waiters", async () => {
  const pool = create3D66BrowserSessionPool();
  const f = fixture();
  let resolve;
  const creation = new Promise(done => { resolve = done; });
  const first = pool.acquire("a", async () => creation);
  const second = pool.acquire("a", () => assert.fail("Waiter must be cancelled"));
  const rejected = Promise.all([assert.rejects(first, /closed/), assert.rejects(second, /closed/)]);
  await pool.closeAll();
  resolve(f.context);
  await rejected;
  assert.equal(f.closed(), 1);
});

test("a stalled storage read cannot block completed work or poison the profile", async t => {
  const pool = create3D66BrowserSessionPool({ snapshotTimeoutMs: 10 });
  t.after(() => pool.closeAll());
  const f = fixture();
  f.frame.evaluate = () => new Promise(() => {});
  const first = await pool.acquire("a", async () => f.context);
  await first.release();
  const second = await pool.acquire("a", () => assert.fail("A snapshot failure does not destroy a healthy context"));
  await second.release({ discard: true });
});
