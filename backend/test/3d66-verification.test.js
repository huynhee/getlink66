import assert from "node:assert/strict";
import test from "node:test";
import { create3D66VerificationStore } from "../src/utils/3d66VerificationStore.js";
import { manual3D66RequestAllowed } from "../src/utils/3d66VerificationGuard.js";
import { assert3D66FootprintPageVerified, get3D66VerificationPage } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { create3D66VerificationService, verify3D66ContextAccount } = await import("../src/utils/3d66VerificationService.js");
const { resume3D66Verification } = await import("../src/utils/3d66BrowserService.js");
const { default: Cookie } = await import("../src/models/Cookie.js");
const productId = "ACI896357714629725";
const base = "https://3d.3d66.com/reshtmla/model/items/fixture/verification.html";
const seed = { productId, modelPage: base, url: `${base}?sof=${productId}&st=2` };
const clean = seed.url + "&sign=real-fixture";

async function fixture(t, options = {}) {
  let clock = 1000;
  const events = [];
  const page = {
    viewportSize: () => ({ width: 1440, height: 900 }),
    async title() { return "Manual fixture"; }, async screenshot() { return Buffer.from("fixture"); },
    async reload() { events.push("reload-same-page"); },
    mouse: { async move(x, y) { events.push(["move", x, y]); }, async down() { events.push("down"); }, async up() { events.push("up"); } },
  };
  const context = { async close() { events.push("close"); }, async cookies() {
    return [{ domain: ".3d66.com", name: "PHPSESSID", value: "verified-fixture" },
      { domain: ".user.3d66.com", name: "login_sign", value: "signed-fixture" },
      { domain: "evil.test", name: "untrusted", value: "no" },
      { domain: "evil3d66.com", name: "PHPSESSID", value: "spoofed-fixture" }];
  } };
  const store = create3D66VerificationStore({ now: () => clock, ...options });
  t.after(() => store.closeAll());
  const entry = await store.retain({ page, context, seed, cookieValue: "fixture-cookie", configurationKey: "fixture-config" });
  return { store, entry, events, page, context, advance: amount => { clock += amount; } };
}

test("challenge errors retain the exact page privately, without putting browser internals on the error", async () => {
  const page = { async title() { return "滑动验证页面"; } };
  await assert.rejects(assert3D66FootprintPageVerified(page), error => {
    assert.equal(get3D66VerificationPage(error), page);
    assert.equal(JSON.stringify(error).includes("page"), false);
    return true;
  });
});

test("pending metadata never exposes cookies, pages, configuration hashes or claim tokens", async t => {
  const { store, entry } = await fixture(t);
  const claim = await store.claim(entry.id, "admin-a");
  assert.equal(claim.token.length, 48);
  assert.deepEqual(Object.keys((await store.list())[0]).sort(), ["id", "productId", "status", "createdAt", "expiresAt", "claimed"].sort());
  await assert.rejects(store.claim(entry.id, "admin-b"), { status: 409 });
  await assert.rejects(store.frame(entry.id, "admin-b", claim.token), { status: 403 });
  for (const token of ["", "🛑".repeat(24), claim.token.slice(1), "a".repeat(48)]) {
    await assert.rejects(store.frame(entry.id, "admin-a", token), { status: 403 });
  }
  await assert.rejects(store.assertAvailable("fixture-cookie", "fixture-config"), { status: 423 });
  await assert.doesNotReject(store.assertAvailable("another-cookie", "fixture-config"));
});

test("manual pointer relay accepts only bounded, sequenced physical events and releases a held pointer", async t => {
  const { store, entry, events } = await fixture(t);
  const { token } = await store.claim(entry.id, "admin");
  for (const event of [{ type: "solve", x: 0, y: 0, sequence: 0 }, { type: "move", x: NaN, y: 0, sequence: 0 },
    { type: "down", x: -1, y: 0, sequence: 0 }, { type: "down", x: 1441, y: 0, sequence: 0 },
    { type: "down", x: 0, y: 0, sequence: "0" }]) {
    await assert.rejects(store.input(entry.id, "admin", token, event), { status: 400 });
  }
  await store.input(entry.id, "admin", token, { type: "down", x: 10, y: 20, sequence: 0 });
  await store.input(entry.id, "admin", token, { type: "move", x: 15, y: 20, sequence: 1 });
  await store.input(entry.id, "admin", token, { type: "down", x: 10, y: 20, sequence: 0 });
  await store.release(entry.id, "admin", token);
  assert.deepEqual(events, [["move", 10, 20], "down", ["move", 15, 20], "up"]);
  await assert.rejects(store.input(entry.id, "admin", token, { type: "up", x: 15, y: 20, sequence: 2 }), { status: 403 });
  assert.equal((await store.list())[0].claimed, false);
});

test("pending direct verification reports the direct stage, not rewritten history", async t => {
  const { store, entry } = await fixture(t);
  entry.seed = { ...entry.seed, mode: "direct" };
  await assert.rejects(store.assertAvailable("fixture-cookie", "fixture-config"), error => {
    assert.equal(error.status, 423);
    assert.equal(error.details.stage, "direct-model");
    assert.equal(error.details.reason, "upstream_verification_pending");
    return true;
  });
});

test("leases expire independently of the browser session; expired sessions close and can be retried", async t => {
  const { store, entry, advance, events } = await fixture(t, { ttlMs: 10000, leaseMs: 1000 });
  const { token } = await store.claim(entry.id, "a");
  advance(1001);
  await assert.rejects(store.frame(entry.id, "a", token), { status: 403 });
  await store.claim(entry.id, "b");
  advance(10000);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(events, ["close"]);
  assert.throws(() => store.get(entry.id), { status: 410 });
});

test("retention is bounded, deduplicated per cookie and invalidated by configuration changes", async t => {
  const { store, entry, context, page, events } = await fixture(t, { maxSessions: 1 });
  assert.equal(await store.retain({ context, page, seed, cookieValue: "fixture-cookie", configurationKey: "fixture-config" }), null);
  assert.equal(await store.retain({ context, page, seed, cookieValue: "another-cookie", configurationKey: "fixture-config" }), null);
  await store.assertAvailable("fixture-cookie", "changed-config");
  assert.equal(store.hasContexts(), false);
  assert.ok(entry.closed);
  assert.deepEqual(events, ["close"]);
});

test("verified contexts reuse only the same account/config/model and never expire in the middle of active work", async t => {
  const { store, entry, advance, events } = await fixture(t, { ttlMs: 10000, readyTtlMs: 1000 });
  await store.verified(entry, "verified-cookie");
  assert.equal(await store.acquireReady("verified-cookie", "fixture-config", "another-model"), null);
  assert.equal(await store.acquireReady("fixture-cookie", "fixture-config", productId), null);
  const ready = await store.acquireReady("verified-cookie", "fixture-config", productId);
  assert.equal(ready.entry.page, entry.page);
  advance(10001);
  await store.list();
  assert.equal(events.includes("close"), false);
  await ready.release();
  await ready.release();
  assert.deepEqual(events, ["close"]);
});

test("Direct verified contexts are also scoped to the exact model path", async t => {
  const { store, entry } = await fixture(t);
  entry.seed = { ...seed, mode: "direct" };
  await store.verified(entry, "verified-cookie");
  assert.equal(await store.acquireReady("verified-cookie", "fixture-config", productId, base + "-other"), null);
  const ready = await store.acquireReady("verified-cookie", "fixture-config", productId, base);
  assert.equal(ready.entry.page, entry.page);
  await ready.release();
});

test("cancel waits for an active operation instead of racing it", async t => {
  const { store, entry, events } = await fixture(t);
  const { token } = await store.claim(entry.id, "a");
  let finish;
  const active = store.operate(entry.id, "a", token, () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const cancel = store.cancel(entry.id, "a", token);
  assert.equal(events.includes("close"), false);
  finish();
  await Promise.all([active, cancel]);
  assert.deepEqual(events, ["close"]);
});

test("reclaiming an expired lease waits for the active owner and invalidates its old token", async t => {
  const { store, entry, advance } = await fixture(t, { leaseMs: 1000 });
  const { token } = await store.claim(entry.id, "admin-a");
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const active = store.operate(entry.id, "admin-a", token, async () => {
    started.resolve();
    await finish.promise;
  });
  await started.promise;
  advance(1001);
  const claim = store.claim(entry.id, "admin-b");
  try {
    assert.equal(entry.owner, "admin-a");
    assert.equal(entry.token, token);
  } finally { finish.resolve(); }
  const [, replacement] = await Promise.all([active, claim]);
  assert.notEqual(replacement.token, token);
  assert.equal(entry.owner, "admin-b");
  await assert.rejects(store.frame(entry.id, "admin-a", token), { status: 403 });
  await assert.rejects(store.frame(entry.id, "admin-b", token), { status: 403 });
  await assert.doesNotReject(store.frame(entry.id, "admin-b", replacement.token));
});

function request(url, { method = "GET", navigation = false, main = true } = {}) {
  const frame = { page: () => ({ mainFrame: () => main ? frame : {} }) };
  return { url: () => url, method: () => method, isNavigationRequest: () => navigation, frame: () => frame };
}

test("the manual request gate admits widget assets but blocks purchases, mutations, other models and unsafe hosts", () => {
  const options = { productId, initialUrl: seed.url };
  const allowed = [request("https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"),
    request("https://captcha.aliyuncs.com/verify", { method: "POST" }), request(clean, { navigation: true }),
    request("https://user.3d66.com/newUser/index/index/footprint", { navigation: true })];
  for (const value of allowed) assert.equal(manual3D66RequestAllowed(value, options), true, value.url());
  const blocked = [request("https://evil.test/"), request("https://o.alicdn.com.evil.test/widget.js"),
    request("http://o.alicdn.com/widget.js"), request("https://user:pass@3d.3d66.com/"),
    request("https://3d.3d66.com:8443/"), request("https://user.3d66.com/api/v1/download/pop"),
    request("https://user.3d66.com/api/v1/download/handle", { method: "POST" }),
    request("https://user.3d66.com/api/v1/order/create"), request("https://user.3d66.com/api/favorites", { method: "POST" }),
    request(clean.replace(productId, "ACI89635771994629725"), { navigation: true }),
    request(clean + "&sof=" + productId, { navigation: true }), request("https://www.3d66.com/", { navigation: true }),
    request("https://o.alicdn.com/arbitrary.html", { navigation: true })];
  for (const value of blocked) assert.equal(manual3D66RequestAllowed(value, options), false, value.url());
});

test("Direct manual verification allows only its model path and never visits history", () => {
  const scope = { productId, initialUrl: clean, mode: "direct", modelPage: base };
  assert.equal(manual3D66RequestAllowed(request(clean, { navigation: true }), scope), true);
  assert.equal(manual3D66RequestAllowed(request("https://captcha.aliyuncs.com/verify", { method: "POST" }), scope), true);
  for (const navigation of [false, true]) {
    for (const url of [clean.replace("verification.html", "other.html"), clean.replace(productId, productId + "99"),
      "https://user.3d66.com/newUser/index/index/footprint"]) {
      assert.equal(manual3D66RequestAllowed(request(url, { navigation }), scope), false);
    }
  }
  assert.equal(manual3D66RequestAllowed(request("https://user.3d66.com/api/v1/download/handle", { method: "POST" }), scope), false);
});

test("Direct completion validates the loaded page without resolving history or accepting another path", async () => {
  let current = clean;
  let afterModelReady = () => {};
  const page = {
    url: () => current, async title() { return "Loaded model"; }, async waitForLoadState() {},
    async goto() { assert.fail("Direct verification must not navigate to history"); },
    locator() { return { first: () => ({ async waitFor() { afterModelReady(); } }) }; },
  };
  const entry = { page, seed: { ...seed, mode: "direct" } };
  const result = await resume3D66Verification(entry);
  assert.equal(result.url, clean);
  assert.equal(result.usedFootprint, false);
  assert.equal(result.canonicalModelPage, base);
  for (const bad of [seed.url, clean.replace("verification.html", "other.html"), clean.replace(productId, productId + "99")]) {
    current = bad;
    await assert.rejects(resume3D66Verification(entry));
  }
  current = clean;
  afterModelReady = () => { current = clean.replace("verification.html", "other.html"); };
  await assert.rejects(resume3D66Verification(entry));
});

async function serviceFixture(t, options = {}, storeOptions = {}) {
  const state = await fixture(t, storeOptions);
  const cookie = await Cookie.create({ value: "fixture-cookie", isActive: true, status: "active" });
  t.after(() => Cookie.deleteOne({ _id: cookie._id }));
  let primeCount = 0;
  const service = create3D66VerificationService({ store: state.store, cookieModel: Cookie,
    configurationKey: () => "fixture-config", decrypt: value => value, encrypt: value => value,
    resume: async entry => { assert.equal(entry.page, state.page); return { url: clean, canonicalModelPage: base }; },
    verifyAccount: async () => {}, prime: () => { primeCount++; }, ...options });
  const claim = await service.claim(state.entry.id, "admin");
  return { ...state, service, cookie, token: claim.token, primes: () => primeCount };
}

test("completion verifies the same context, saves the cookie once, primes only the signed target and preserves the context", async t => {
  const { store, service, entry, token, cookie, primes } = await serviceFixture(t);
  await service.reload(entry.id, "admin", token);
  assert.deepEqual(await service.complete(entry.id, "admin", token), { ok: true });
  assert.equal((await Cookie.findById(cookie._id)).value, "PHPSESSID=verified-fixture; login_sign=signed-fixture");
  assert.equal(primes(), 1);
  assert.equal(entry.status, "verified");
  await assert.rejects(service.complete(entry.id, "admin", token), { status: 410 });
  assert.deepEqual(await store.list(), []);
  assert.equal((await store.acquireReady("PHPSESSID=verified-fixture; login_sign=signed-fixture", "fixture-config", productId)).entry, entry);
});

test("Direct saves only after explicit completion and does not prime rewritten history", async t => {
  const { service, entry, cookie, token, primes, store } = await serviceFixture(t);
  entry.seed = { ...seed, mode: "direct" };
  assert.equal((await Cookie.findById(cookie._id)).value, "fixture-cookie");
  const saved = t.mock.method(Cookie, "findOneAndUpdate");
  await service.complete(entry.id, "admin", token);
  assert.equal(saved.mock.callCount(), 1);
  assert.equal(primes(), 0);
  assert.equal(entry.status, "verified");
  const ready = await store.acquireReady("PHPSESSID=verified-fixture; login_sign=signed-fixture", "fixture-config", productId, base);
  assert.equal(ready.entry.page, entry.page);
  await ready.release();
});

test("Direct cannot rebind a verified result to another path before saving cookies", async t => {
  const other = base.replace("verification.html", "other.html");
  const { service, entry, cookie, token, primes } = await serviceFixture(t, {
    resume: async () => ({ url: clean.replace(base, other), canonicalModelPage: other }),
  });
  entry.seed = { ...seed, mode: "direct" };
  const saved = t.mock.method(Cookie, "findOneAndUpdate");
  await assert.rejects(service.complete(entry.id, "admin", token));
  assert.equal(saved.mock.callCount(), 0);
  assert.equal((await Cookie.findById(cookie._id)).value, "fixture-cookie");
  assert.equal(entry.status, "pending");
  assert.equal(primes(), 0);
});

test("wrong account or model never saves cookies and leaves verification available", async t => {
  for (const options of [{ verifyAccount: async () => { throw new Error("Wrong account"); } },
    { resume: async () => ({ url: clean.replace(productId, "ACI89635771994629725"), canonicalModelPage: base }) },
    { resume: async () => ({ url: seed.url, canonicalModelPage: base }) }]) {
    const { service, entry, cookie, token, primes } = await serviceFixture(t, options);
    await assert.rejects(service.complete(entry.id, "admin", token));
    assert.equal((await Cookie.findById(cookie._id)).value, "fixture-cookie");
    assert.equal(entry.status, "pending");
    assert.equal(primes(), 0);
    await service.cancel(entry.id, "admin", token);
  }
});

test("changed source cookies cannot be overwritten by an old retained browser", async t => {
  const { service, entry, cookie, token } = await serviceFixture(t);
  await Cookie.findOneAndUpdate({ _id: cookie._id }, { $set: { value: "new-cookie" } });
  await assert.rejects(service.complete(entry.id, "admin", token), { status: 409 });
  assert.equal((await Cookie.findById(cookie._id)).value, "new-cookie");
  assert.equal(entry.closed, true);
});

test("a source cookie edited during account verification fails compare-and-swap without overwriting the edit", async t => {
  let edited;
  const verifyAccount = t.mock.fn(async (retained, cookieValue) => {
    assert.equal(retained, entry);
    assert.equal(cookieValue, "PHPSESSID=verified-fixture; login_sign=signed-fixture");
    edited = await Cookie.findByIdAndUpdate(cookie._id, { $set: {
      value: "admin-replacement", status: "warning", failureCount: 7, lastErrorMessage: "Keep this manual edit",
    } });
  });
  const { service, entry, cookie, token, primes, events } = await serviceFixture(t, { verifyAccount });
  const save = t.mock.method(Cookie, "findOneAndUpdate");
  await assert.rejects(service.complete(entry.id, "admin", token), {
    status: 409, message: "The source cookie changed. Nothing was overwritten.",
  });
  assert.equal(verifyAccount.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
  assert.deepEqual(save.mock.calls[0].arguments[0], {
    _id: cookie._id, value: "fixture-cookie", isActive: { $ne: false }, status: { $ne: "disabled" },
  });
  assert.deepEqual(await Cookie.findById(cookie._id), edited);
  assert.equal(primes(), 0);
  assert.equal(entry.status, "pending");
  await assert.rejects(service.complete(entry.id, "admin", token), { status: 409 });
  assert.equal(verifyAccount.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(entry.closed, true);
  assert.deepEqual(events, ["close"]);
});

test("a browser cookie refreshed during account verification is not saved until the exact header is verified again", async t => {
  let refreshed = false;
  const verifyAccount = t.mock.fn(async () => { refreshed = true; });
  const { service, entry, context, cookie, token, primes } = await serviceFixture(t, { verifyAccount });
  t.mock.method(context, "cookies", async () => [
    { domain: ".3d66.com", name: "PHPSESSID", value: refreshed ? "refreshed-fixture" : "verified-fixture" },
    { domain: ".user.3d66.com", name: "login_sign", value: "signed-fixture" },
  ]);
  const save = t.mock.method(Cookie, "findOneAndUpdate");
  await assert.rejects(service.complete(entry.id, "admin", token), {
    status: 409, message: "The source session was refreshed. Verify and save it again.",
  });
  assert.equal(save.mock.callCount(), 0);
  assert.equal(primes(), 0);
  assert.deepEqual(await Cookie.findById(cookie._id), cookie);
  assert.equal(entry.closed, false);
  assert.equal(entry.status, "pending");
  assert.deepEqual(await service.complete(entry.id, "admin", token), { ok: true });
  assert.deepEqual(verifyAccount.mock.calls.map(call => call.arguments[1]), [
    "PHPSESSID=verified-fixture; login_sign=signed-fixture",
    "PHPSESSID=refreshed-fixture; login_sign=signed-fixture",
  ]);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(primes(), 1);
  assert.equal((await Cookie.findById(cookie._id)).value, "PHPSESSID=refreshed-fixture; login_sign=signed-fixture");
});

test("disabled source cookies cannot be saved before or during account verification", async t => {
  for (const [name, changes] of [["inactive flag", { isActive: false }], ["disabled status", { status: "disabled" }]]) {
    for (const duringVerification of [false, true]) {
      await t.test(`${name}, disabled ${duringVerification ? "during" : "before"} verification`, async t => {
        let disabled;
        const verifyAccount = t.mock.fn(async () => {
          disabled = await Cookie.findByIdAndUpdate(cookie._id, { $set: changes });
        });
        const { service, entry, cookie, token, primes, events } = await serviceFixture(t, { verifyAccount });
        if (!duringVerification) disabled = await Cookie.findByIdAndUpdate(cookie._id, { $set: changes });
        const save = t.mock.method(Cookie, "findOneAndUpdate");
        await assert.rejects(service.complete(entry.id, "admin", token), { status: 409 });
        assert.deepEqual(await Cookie.findById(cookie._id), disabled);
        assert.equal(save.mock.callCount(), duringVerification ? 1 : 0);
        assert.equal(verifyAccount.mock.callCount(), duringVerification ? 1 : 0);
        assert.equal(primes(), 0);
        if (duringVerification) {
          await assert.rejects(service.complete(entry.id, "admin", token), { status: 409 });
          assert.equal(save.mock.callCount(), 1);
          assert.equal(verifyAccount.mock.callCount(), 1);
        }
        assert.equal(entry.closed, true);
        assert.deepEqual(events, ["close"]);
      });
    }
  }
});

test("configuration changed during account verification discards the browser before saving or priming", async t => {
  let configuration = "fixture-config";
  const verifyAccount = t.mock.fn(async () => { configuration = "changed-config"; });
  const { service, entry, cookie, token, primes, events, store } = await serviceFixture(t, {
    configurationKey: () => configuration, verifyAccount,
  });
  const save = t.mock.method(Cookie, "findOneAndUpdate");
  await assert.rejects(service.complete(entry.id, "admin", token), { status: 409 });
  assert.equal(verifyAccount.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(primes(), 0);
  assert.deepEqual(await Cookie.findById(cookie._id), cookie);
  assert.equal(entry.closed, true);
  assert.deepEqual(events, ["close"]);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.acquireReady("PHPSESSID=verified-fixture; login_sign=signed-fixture", "changed-config", productId), null);
});

test("simultaneous completions verify, save and prime exactly once", async t => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const verifyAccount = t.mock.fn(async () => {
    started.resolve();
    await finish.promise;
  });
  const { service, entry, cookie, token, primes, store } = await serviceFixture(t, { verifyAccount });
  const save = t.mock.method(Cookie, "findOneAndUpdate");
  const first = service.complete(entry.id, "admin", token);
  await started.promise;
  const results = Promise.allSettled([first, service.complete(entry.id, "admin", token)]);
  finish.resolve();
  const [completed, duplicate] = await results;
  assert.deepEqual(completed, { status: "fulfilled", value: { ok: true } });
  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.reason.status, 410);
  assert.equal(verifyAccount.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(primes(), 1);
  assert.equal((await Cookie.findById(cookie._id)).value, "PHPSESSID=verified-fixture; login_sign=signed-fixture");
  assert.equal(entry.status, "verified");
  assert.equal(entry.closed, false);
  assert.equal(entry.owner, "");
  assert.equal(entry.token, "");
  const ready = await store.acquireReady("PHPSESSID=verified-fixture; login_sign=signed-fixture", "fixture-config", productId);
  assert.equal(ready.entry, entry);
  await ready.release();
});

test("completion rejects a different owner or a released claim before verification or saving", async t => {
  const verifyAccount = t.mock.fn(async () => {});
  const { service, entry, cookie, token, primes } = await serviceFixture(t, { verifyAccount });
  const save = t.mock.method(Cookie, "findOneAndUpdate");
  await assert.rejects(service.complete(entry.id, "admin-b", token), { status: 403 });
  await service.release(entry.id, "admin", token);
  const replacement = await service.claim(entry.id, "admin-b");
  await assert.rejects(service.complete(entry.id, "admin", token), { status: 403 });
  await assert.rejects(service.complete(entry.id, "admin-b", token), { status: 403 });
  assert.equal(entry.owner, "admin-b");
  assert.equal(entry.token, replacement.token);
  assert.equal(verifyAccount.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(primes(), 0);
  assert.deepEqual(await Cookie.findById(cookie._id), cookie);
});

test("queued completion revalidates both lease and session expiry before verifying or saving", async t => {
  for (const [name, duration, status] of [["lease", 1000, 403], ["session", 10000, 410]]) {
    await t.test(`${name} expires while completion waits`, async t => {
      const started = Promise.withResolvers();
      const finish = Promise.withResolvers();
      const verifyAccount = t.mock.fn(async () => {});
      const { service, store, entry, cookie, token, primes, advance, events } = await serviceFixture(t,
        { verifyAccount }, { leaseMs: 1000, ttlMs: 10000 });
      const save = t.mock.method(Cookie, "findOneAndUpdate");
      const active = store.operate(entry.id, "admin", token, async () => {
        started.resolve();
        await finish.promise;
      });
      await started.promise;
      const completion = assert.rejects(service.complete(entry.id, "admin", token), { status });
      advance(duration);
      finish.resolve();
      await Promise.all([active, completion]);
      assert.equal(verifyAccount.mock.callCount(), 0);
      assert.equal(save.mock.callCount(), 0);
      assert.equal(primes(), 0);
      assert.deepEqual(await Cookie.findById(cookie._id), cookie);
      if (name === "session") {
        assert.deepEqual(await store.list(), []);
        assert.equal(entry.closed, true);
        assert.deepEqual(events, ["close"]);
      }
    });
  }
});

test("a database failure after manual verification keeps the same browser for an explicit retry", async t => {
  const { service, entry, cookie, token } = await serviceFixture(t);
  const update = t.mock.method(Cookie, "findOneAndUpdate", async () => { throw new Error("Atlas unavailable fixture"); });
  await assert.rejects(service.complete(entry.id, "admin", token));
  assert.equal(entry.closed, false);
  assert.equal((await Cookie.findById(cookie._id)).value, "fixture-cookie");
  update.mock.restore();
  await service.complete(entry.id, "admin", token);
  assert.equal(entry.status, "verified");
});

test("account verification uses the retained request context, rejects redirects and never trusts browser cookie fields", async () => {
  const events = [];
  const cookieValue = "PHPSESSID=verified-fixture; login_sign=signed-fixture";
  let code = 200;
  let id = "177536980";
  const entry = { context: { request: { async get(url, options) {
    assert.equal(url, "https://user.3d66.com/new-user-api/api/v1/user/info");
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.headers.cookie, cookieValue);
    return { ok: () => code === 200, async json() { return { code, data: { basic: { user_id: id } } }; },
      async dispose() { events.push("disposed"); } };
  } } } };
  await verify3D66ContextAccount(entry, cookieValue);
  id = "123456780";
  await assert.rejects(verify3D66ContextAccount(entry, cookieValue), { status: 422 });
  code = 302;
  await assert.rejects(verify3D66ContextAccount(entry, cookieValue), { status: 422 });
  assert.equal(events.length, 3);
});
