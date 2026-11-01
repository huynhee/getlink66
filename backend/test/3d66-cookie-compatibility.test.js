import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { inspect3D66CookieHeader, parse3D66CookieHeader } from "../src/utils/3d66CookieHeader.js";
import { encryptSecret } from "../src/utils/secretBox.js";

useMemoryDb();
const env = { THREED66_MOCK: "false", THREED66_REQUIRED_ACCOUNT_MARKER: "89635771",
  THREED66_PROXY_ENABLED: "false", THREED66_MODEL_RESOLVE_MODE: "direct" };
const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const { default: Cookie } = await import("../src/models/Cookie.js");
const { validate3D66Cookie, fetch3D66Preview } = await import("../src/utils/3d66Service.js");
const { getUsable3D66Cookies, get3D66CookiePoolStatus } = await import("../src/utils/3d66CookiePool.js");
const { listCookies, testSavedCookie } = await import("../src/controllers/adminController.js");
const { get3D66Status } = await import("../src/controllers/systemController.js");
const cookie = "PHPSESSID=fixture; login_sign=opaque-fixture";
const endpoint = "https://user.3d66.com/new-user-api/api/v1/user/info";
const validSession = () => Response.json({ code: 200, data: { basic: { user_id: 177536980 } } });

beforeEach(async () => {
  Object.assign(process.env, env);
  await Cookie.deleteMany({});
});

async function invoke(handler, req = {}) {
  let result;
  await handler(req, { json(value) { result = value; }, status() { return this; } }, (error) => { throw error; });
  return result;
}

test("cookie parsing accepts current and legacy cookies without requiring login_token", () => {
  for (const value of [cookie, cookie + "; login_token=legacy-fixture", cookie + "; login_token="]) {
    assert.deepEqual(inspect3D66CookieHeader(value).missingKeys, []);
    assert.equal(inspect3D66CookieHeader(value).hasRequiredKeys, true);
  }
  assert.equal(parse3D66CookieHeader("PHPSESSID = fixture; login_sign = a%3Ab==").get("login_sign"), "a%3Ab==");
  for (const value of ["", "PHPSESSID=fixture", "login_sign=fixture", "PHPSESSID=; login_sign=x",
    cookie + "\r\nX-Injected: x", "userCookieData=%7B%22user_id%22%3A177536980%7D"]) {
    assert.equal(inspect3D66CookieHeader(value).hasRequiredKeys, false);
  }
});

test("pool, admin list and public status consistently accept a structurally complete cookie without login_token", async () => {
  await Cookie.create({ value: encryptSecret(cookie), isActive: true, status: "active", lastTestOk: true });
  assert.equal((await getUsable3D66Cookies()).length, 1);
  const pool = await get3D66CookiePoolStatus();
  assert.equal(pool.stats.invalid, 0);
  assert.deepEqual(pool.cookies[0].missingKeys, []);
  const listed = await invoke(listCookies);
  assert.equal(listed.cookies[0].hasRequiredKeys, true);
  assert.deepEqual(listed.cookies[0].missingKeys, []);
  assert.ok(!JSON.stringify(listed).includes("opaque-fixture"));
  assert.equal((await invoke(get3D66Status)).online, true);
});

test("admin verification authenticates against the fixed server endpoint rather than trusting cookie fields", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls += 1;
    assert.equal(url, endpoint);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.cookie, cookie);
    return validSession();
  });
  assert.deepEqual(await validate3D66Cookie(cookie), { ok: true, mode: "account-session", authenticated: true, accountMarker: "89635771" });
  assert.equal(calls, 1);
});

test("a legacy login_token is still forwarded unchanged when present", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.cookie, cookie + "; login_token=legacy-fixture");
    return validSession();
  });
  assert.equal((await validate3D66Cookie(cookie + "; login_token=legacy-fixture")).authenticated, true);
});

test("forged local userCookieData cannot replace a real authenticated server response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: 401, msg: "Sign in" }));
  await assert.rejects(validate3D66Cookie(cookie + "; userCookieData=%7B%22user_id%22%3A177536980%7D"),
    { status: 401, code: "THREED66_SESSION_INVALID" });
});

test("an authenticated cookie for a different account cannot pass the required clean-link marker", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: 200, data: { basic: { user_id: 123456780 } } }));
  await assert.rejects(validate3D66Cookie(cookie), { status: 422, code: "THREED66_COOKIE_ACCOUNT_MISMATCH" });
});

for (const [label, response] of [
  ["HTML challenge", () => new Response("<html>Challenge</html>", { status: 403 })],
  ["missing identity", () => Response.json({ code: 200, data: { basic: {} } })],
  ["server failure", () => Response.json({ code: 200, data: { basic: { user_id: 177536980 } } }, { status: 500 })],
]) {
  test(`${label} does not become successful cookie verification`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(validate3D66Cookie(cookie), { status: 503, code: "THREED66_AUTH_UNAVAILABLE" });
  });
}

test("auth redirects are never followed with credentials to another host", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://untrusted.example.test/" } });
  });
  await assert.rejects(validate3D66Cookie(cookie), { status: 401, code: "THREED66_SESSION_INVALID" });
  assert.equal(calls, 1);
});

test("auth failures do not leak cookie values or mark a saved cookie as verified", async (t) => {
  const saved = await Cookie.create({ value: encryptSecret(cookie), isActive: true });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private-transport-fixture"); });
  await assert.rejects(invoke(testSavedCookie, { params: { id: String(saved._id) }, body: {} }), (error) => {
    assert.equal(error.code, "THREED66_AUTH_UNAVAILABLE");
    assert.ok(!error.message.includes("private-transport-fixture"));
    assert.ok(!error.message.includes("opaque-fixture"));
    return true;
  });
  assert.equal((await Cookie.findById(saved._id)).lastTestOk, false);
});

test("successful saved-cookie verification clears old warnings without returning the secret", async (t) => {
  const saved = await Cookie.create({ value: encryptSecret(cookie), isActive: true, status: "warning", lastTestOk: false });
  t.mock.method(globalThis, "fetch", async () => validSession());
  const result = await invoke(testSavedCookie, { params: { id: String(saved._id) }, body: {} });
  assert.equal(result.authenticated, true);
  assert.equal(result.cookie.lastTestOk, true);
  assert.equal(result.cookie.status, "active");
  assert.ok(!JSON.stringify(result).includes("opaque-fixture"));
});

test("an optional dirty model URL is rejected after login verification, never opened directly", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => { urls.push(url); return validSession(); });
  await assert.rejects(validate3D66Cookie(cookie,
    "https://3d.3d66.com/reshtmla/model/items/fixture/cookie.html?sof=GCI139810814629725&sign=old-fixture"),
  { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.deepEqual(urls, [endpoint]);
});

test("download preview no longer stops at a missing login_token but still requires a clean signed context", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; assert.fail("Dirty model must not reach upstream"); });
  await assert.rejects(fetch3D66Preview(
    "https://3d.3d66.com/reshtmla/model/items/fixture/cookie.html?sof=GCI139810814629725&sign=old-fixture", cookie),
  { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.equal(calls, 0);
});
