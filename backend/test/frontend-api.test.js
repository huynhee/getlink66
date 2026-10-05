import test from "node:test";
import assert from "node:assert/strict";

let fixtureId = 0;
async function fixture(t, fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = original; });
  return import(`../../frontend/src/api.js?fixture=${++fixtureId}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

const json = (data, status = 200) => Response.json(data, { status });

test("invalidated downloads requests cannot repopulate the public cache", async (t) => {
  const old = deferred();
  let calls = 0;
  const api = await fixture(t, () => ++calls === 1 ? old.promise : Promise.resolve(json({ version: "1.0.2" })));
  const pending = api.apiCached("/api/plugin/downloads");
  api.invalidateApiCache("/api/plugin/downloads");
  old.resolve(json({ version: "1.0.1" }));
  assert.deepEqual(await pending, { version: "1.0.1" });
  assert.deepEqual(await api.apiCached("/api/plugin/downloads"), { version: "1.0.2" });
  assert.equal(calls, 2);
});

test("a slow cache request cannot overwrite a forced refresh or remove its pending request", async (t) => {
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  const api = await fixture(t, () => ++calls === 1 ? old.promise : fresh.promise);
  const pending = api.apiCached("/api/plugin/downloads");
  const refresh = api.apiCached("/api/plugin/downloads", { force: true });
  old.resolve(json({ version: "1.0.1" }));
  await pending;
  assert.equal(api.apiCached("/api/plugin/downloads"), refresh);
  fresh.resolve(json({ version: "1.0.2" }));
  await refresh;
  assert.deepEqual(await api.apiCached("/api/plugin/downloads"), { version: "1.0.2" });
  assert.equal(calls, 2);
});

test("a slower cache response cannot replace an already completed newer response", async (t) => {
  const old = deferred();
  let calls = 0;
  const api = await fixture(t, () => ++calls === 1 ? old.promise : Promise.resolve(json({ available: false })));
  const pending = api.apiCached("/api/plugin/downloads");
  await api.apiCached("/api/plugin/downloads", { force: true });
  old.resolve(json({ available: true }));
  await pending;
  assert.deepEqual(await api.apiCached("/api/plugin/downloads"), { available: false });
  assert.equal(calls, 2);
});

for (const method of ["api", "apiBinary"]) {
  test(`${method} pause aborts CSRF initialization before submitting a mutation`, async (t) => {
    const requests = [];
    const api = await fixture(t, (url, options) => {
      requests.push(url);
      assert.ok(url.endsWith("/api/auth/csrf"));
      assert.equal(options.credentials, "include");
      return new Promise((_resolve, reject) => {
        assert.ok(options.signal);
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    });
    const controller = new AbortController();
    const pending = method === "api"
      ? api.api("/api/admin/plugin/releases", { method: "POST", signal: controller.signal })
      : api.apiBinary("/api/admin/plugin/releases/chunks/0", new Blob(["chunk"]), { method: "PUT", signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requests.length, 1);
  });
}

test("binary CSRF retry preserves the original chunk, credentials and refreshed token", async (t) => {
  const requests = [];
  let tokens = 0;
  let uploads = 0;
  const api = await fixture(t, async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/api/auth/csrf")) return json({ csrfToken: `token-${++tokens}` });
    return ++uploads === 1 ? json({ message: "Invalid CSRF token" }, 403) : json({ receivedChunks: [0] });
  });
  const body = new Blob([new Uint8Array(8 * 1024 * 1024)]);
  assert.deepEqual(await api.apiBinary("/api/admin/plugin/releases/chunks/0", body, { method: "PUT" }), { receivedChunks: [0] });
  const chunks = requests.filter((request) => request.options.method === "PUT");
  assert.equal(chunks.length, 2);
  for (const request of chunks) {
    assert.equal(request.options.body, body);
    assert.equal(request.options.body.size, 8 * 1024 * 1024);
    assert.equal(request.options.credentials, "include");
  }
  assert.equal(chunks[0].options.headers["x-csrf-token"], "token-1");
  assert.equal(chunks[1].options.headers["x-csrf-token"], "token-2");
});

test("aborting while reading a successful response does not report a successful upload", async (t) => {
  const controller = new AbortController();
  const api = await fixture(t, async (url) => {
    if (url.endsWith("/api/auth/csrf")) return json({ csrfToken: "token" });
    return { ok: true, status: 200, text: async () => { controller.abort(); throw controller.signal.reason; } };
  });
  await assert.rejects(api.apiBinary("/api/admin/plugin/releases/chunks/0", new Blob(["chunk"]), { signal: controller.signal }), { name: "AbortError" });
});

for (const language of ["vi", "en"]) {
  test(`PayPal HTTP errors display a safe ${language} payment message rather than a false gateway timeout`, async (t) => {
    const originalWindow = globalThis.window;
    globalThis.window = { localStorage: { getItem: () => language } };
    t.after(() => {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    });
    const api = await fixture(t, async () => json({ code: "PAYPAL_API_ERROR", message: "Internal server error", correlationId: "fixture-error-id" }, 502));
    await assert.rejects(api.api("/api/payments/paypal/orders/topup/fixture/capture"), (error) => {
      assert.match(error.message, language === "en" ? /PayPal payment could not be processed/ : /Chưa thể xử lý thanh toán PayPal/);
      assert.ok(!error.message.includes("Gateway"));
      assert.equal(error.status, 502);
      assert.equal(error.data.correlationId, "fixture-error-id");
      return true;
    });
  });
}

test("PayPal timeout feedback directs users to check history before another attempt", async (t) => {
  const api = await fixture(t, async () => json({ code: "PAYPAL_API_TIMEOUT", message: "Internal server error" }, 504));
  await assert.rejects(api.api("/api/topup/fixture/status"), /Kiểm tra lịch sử thanh toán/);
});

test("an HTML gateway response does not assert that the backend timed out", async (t) => {
  const api = await fixture(t, async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(api.api("/api/topup/fixture/status"), (error) => {
    assert.match(error.message, /HTTP 502/);
    assert.ok(!error.message.includes("không nhận được phản hồi kịp thời"));
    assert.ok(!error.message.includes("<html>"));
    return true;
  });
});
