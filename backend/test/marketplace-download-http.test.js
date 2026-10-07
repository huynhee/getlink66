import assert from "node:assert/strict";
import { createServer } from "node:http";
import compression from "compression";
import express from "express";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "proxy";
process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "transfer-fixture-token";
process.env.DOWNLOAD_TOKEN_SECRET = "marketplace-transfer-fixture-secret-32";
process.env.LOG_LEVEL = "silent";
for (const key of ["GOOGLE_DRIVE_BEARER_TOKEN", "GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]) delete process.env[key];

const { default: User } = await import("../src/models/User.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: CreditLedgerEntry } = await import("../src/models/CreditLedgerEntry.js");
const { default: logger } = await import("../src/utils/logger.js");
const { createMarketplaceDownloadSession } = await import("../src/utils/marketplaceDownloadService.js");
const { invalidateMarketplacePricingCache } = await import("../src/utils/marketplacePricingService.js");
const { downloadSessionFile } = await import("../src/controllers/marketplaceController.js");
const { downloadTransferLimiter } = await import("../src/utils/downloadTransfer.js");

let sequence = 0;
const payload = Buffer.alloc(6 * 128 * 1024);
for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251;
const etag = '"transfer-fixture-v1"';
const lastModified = "Wed, 07 Oct 2026 02:00:00 GMT";

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Transfer fixture timed out");
}

function driveResponse(options = {}) {
  const headers = new Headers(options.headers);
  assert.equal(headers.get("accept-encoding"), "identity");
  assert.ok(options.signal instanceof AbortSignal);
  const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range"));
  const matching = !headers.has("if-range") || headers.get("if-range") === etag;
  const partial = range && matching;
  const start = partial ? Number(range[1]) : 0;
  const end = partial ? Number(range[2]) : payload.length - 1;
  return new Response(payload.subarray(start, end + 1), {
    status: partial ? 206 : 200,
    headers: {
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      ...(partial ? { "content-range": `bytes ${start}-${end}/${payload.length}` } : {}),
      etag,
      "last-modified": lastModified,
    },
  });
}

async function fixture(t, { assetType = "model", clientType = "web", paymentMethod = "credit", source = driveResponse } = {}) {
  sequence += 1;
  const user = await User.create({ email: `marketplace-transfer-${sequence}@example.test`, credit: 100 });
  await SiteSetting.findOneAndUpdate({ key: "homepage" }, { $set: {
    key: "homepage", marketplaceModelCreditPrice: 5, marketplaceSceneCreditPrice: 20,
  } }, { upsert: true, new: true });
  invalidateMarketplacePricingCache();
  const asset = await MarketplaceModel.create({
    assetType, title: `Transfer ${sequence}`, slug: `transfer-${sequence}`,
    accessType: paymentMethod === "free_quota" ? "free" : "member",
    metadataStatus: "complete", fileStatus: "ready", isPublished: true, downloadCount: 0,
    storageProvider: "google_drive", driveFileId: `transfer-drive-${sequence}`, fileSize: payload.length,
    source: { provider: "google_drive", assetId: `transfer-asset-${sequence}` },
  });
  const created = await createMarketplaceDownloadSession({
    req: { user, body: { paymentMethod, clientRequestId: `transfer-request-${sequence}` }, ip: "127.0.0.1",
      get: (name) => name === "idempotency-key" ? `transfer-plugin-${sequence}` : "transfer-test" },
    modelId: asset._id, expectedAssetType: assetType, clientType,
  });
  const requests = [];
  const metrics = [];
  const errors = [];
  t.mock.method(logger, "info", (entry) => { if (entry.type === "MARKETPLACE_DOWNLOAD_TRANSFER") metrics.push(entry); });
  t.mock.method(logger, "error", (entry) => errors.push(entry));
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    if (String(input).startsWith("http://127.0.0.1:")) return realFetch(input, options);
    assert.equal(new URL(input).hostname, "www.googleapis.com");
    assert.match(String(input), /alt=media/);
    requests.push(options);
    return source(options);
  });
  const app = express();
  app.use(compression());
  app.use((req, _res, next) => {
    req.user = { _id: req.get("x-test-user") || user._id };
    next();
  });
  app.get("/api/download/session/:id/file", downloadSessionFile);
  app.get("/api/plugin/download/session/:id/file", downloadSessionFile);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { user, asset, created, requests, metrics, errors,
    url: `http://127.0.0.1:${server.address().port}${created.downloadUrl}`,
    fetch: realFetch,
  };
}

for (const assetType of ["model", "scene"]) {
  test(`${assetType}: six concurrent web/plugin ranges preserve bytes and bill only once`, async (t) => {
    let finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    t.after(() => finish());
    const f = await fixture(t, { assetType, clientType: assetType === "scene" ? "plugin" : "web", source(options) {
      if (new Headers(options.headers).has("range")) assert.equal(new Headers(options.headers).get("if-range"), etag);
      const response = driveResponse(options);
      let sent = false;
      return new Response(new ReadableStream({ async pull(stream) {
        if (sent) return stream.close();
        await gate;
        sent = true;
        stream.enqueue(new Uint8Array(await response.arrayBuffer()));
        stream.close();
      } }), { status: response.status, headers: response.headers });
    } });
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => f.fetch(f.url, {
      headers: { range: `bytes=${i * 128 * 1024}-${(i + 1) * 128 * 1024 - 1}`, "if-range": etag, "accept-encoding": "gzip" },
    })));
    const rejected = await f.fetch(f.url, { headers: { range: "bytes=0-10" } });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("retry-after"), "5");
    await rejected.arrayBuffer();
    assert.equal(f.requests.length, 6);
    finish();
    const parts = await Promise.all(responses.map(async (response, i) => {
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes ${i * 128 * 1024}-${(i + 1) * 128 * 1024 - 1}/${payload.length}`);
      assert.equal(response.headers.get("content-length"), String(128 * 1024));
      assert.equal(response.headers.get("etag"), etag);
      assert.equal(response.headers.get("last-modified"), lastModified);
      assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("location"), null);
      return Buffer.from(await response.arrayBuffer());
    }));
    assert.deepEqual(Buffer.concat(parts), payload);
    await waitFor(() => f.metrics.length === 6);
    assert.ok(f.metrics.every((item) => item.completed && item.partial && item.receivedBytes === 128 * 1024));
    const cost = assetType === "scene" ? 20 : 5;
    assert.equal((await User.findById(f.user._id)).credit, 100 - cost);
    assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 1);
    assert.equal(await DailyDownloadQuota.countDocuments({ userId: f.user._id }), 0);
    assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 1);
    assert.equal(await ModelDownload.countDocuments({ userId: f.user._id, status: "downloaded" }), 1);
    const retry = await f.fetch(f.url);
    assert.equal(retry.status, 200);
    assert.deepEqual(Buffer.from(await retry.arrayBuffer()), payload);
    assert.equal((await User.findById(f.user._id)).credit, 100 - cost);
    assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 1);
  });
}

test("HEAD and invalid ownership/ranges do not charge or count a download", async (t) => {
  const f = await fixture(t);
  const forbidden = await f.fetch(f.url, { headers: { "x-test-user": "000000000000000000000001" } });
  assert.equal(forbidden.status, 403);
  await forbidden.arrayBuffer();
  for (const range of ["invalid", "bytes=10-1", "bytes=0-1,2-3", "bytes=-0", "bytes=9007199254740992-"]) {
    const response = await f.fetch(f.url, { headers: { range } });
    assert.equal(response.status, 416, range);
    await response.arrayBuffer();
  }
  assert.equal(f.requests.length, 0);
  const head = await f.fetch(f.url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(payload.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await User.findById(f.user._id)).credit, 100);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 0);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 0);
  const get = await f.fetch(f.url);
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), payload);
  assert.equal((await User.findById(f.user._id)).credit, 95);
});

test("stale and weak If-Range validators return the complete representation", async (t) => {
  const f = await fixture(t);
  for (const validator of ['"previous-version"', 'W/"previous-version"']) {
    const response = await f.fetch(f.url, { headers: { range: "bytes=0-99", "if-range": validator } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-range"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  }
  assert.equal(new Headers(f.requests[0].headers).get("if-range"), '"previous-version"');
  assert.equal(new Headers(f.requests[1].headers).get("range"), null);
  assert.equal((await User.findById(f.user._id)).credit, 95);
});

test("Drive errors and exhausted shared capacity fail before Credit billing", async (t) => {
  const f = await fixture(t, { source(options) {
    if (new Headers(options.headers).has("range")) return new Response("", { status: 416, headers: { "content-range": `bytes */${payload.length}` } });
    return new Response("Temporary Drive failure", { status: 503 });
  } });
  const slots = Array.from({ length: 6 }, () => downloadTransferLimiter.acquire({ userId: f.user._id, ip: "127.0.0.1", range: "bytes=0-10" }));
  assert.ok(slots.every((slot) => slot.ok));
  try {
    const busy = await f.fetch(f.url);
    assert.equal(busy.status, 429);
    await busy.arrayBuffer();
    assert.equal(f.requests.length, 0);
  } finally {
    slots.forEach((slot) => slot.release());
  }
  const unsatisfiable = await f.fetch(f.url, { headers: { range: "bytes=999999-" } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${payload.length}`);
  await unsatisfiable.arrayBuffer();
  const failed = await f.fetch(f.url);
  assert.equal(failed.status, 502);
  await failed.arrayBuffer();
  assert.equal((await User.findById(f.user._id)).credit, 100);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 0);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 0);
});

test("closing the client while Drive is opening aborts upstream without billing", async (t) => {
  let canceled = false;
  let waiting = true;
  const f = await fixture(t, { source(options) {
    if (!waiting) return driveResponse(options);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        canceled = true;
        reject(options.signal.reason);
      }, { once: true });
    });
  } });
  const client = new AbortController();
  const attempt = f.fetch(f.url, { signal: client.signal });
  const rejected = assert.rejects(attempt, { name: "AbortError" });
  await waitFor(() => f.requests.length === 1);
  client.abort();
  await rejected;
  await waitFor(() => canceled);
  assert.equal((await User.findById(f.user._id)).credit, 100);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 0);
  waiting = false;
  const retry = await f.fetch(f.url);
  assert.deepEqual(Buffer.from(await retry.arrayBuffer()), payload);
  assert.equal((await User.findById(f.user._id)).credit, 95);
});

test("an upstream truncation is logged as incomplete and retry does not bill twice", async (t) => {
  let fail;
  let truncate = true;
  const failure = new Promise((resolve) => { fail = resolve; });
  t.after(() => fail());
  const f = await fixture(t, { source(options) {
    if (!truncate) return driveResponse(options);
    let sent = false;
    return new Response(new ReadableStream({ async pull(stream) {
      if (!sent) {
        sent = true;
        stream.enqueue(payload.subarray(0, 65536));
      } else {
        await failure;
        stream.error(new Error("upstream terminated"));
      }
    } }), { headers: { "content-length": String(payload.length) } });
  } });
  const response = await f.fetch(f.url);
  const reader = response.body.getReader();
  assert.ok((await reader.read()).value.byteLength > 0);
  fail();
  await assert.rejects(async () => { while (!(await reader.read()).done) { /* Drain until upstream interruption. */ } });
  await waitFor(() => f.metrics.length === 1);
  assert.equal(f.metrics[0].completed, false);
  assert.ok(f.metrics[0].receivedBytes < payload.length);
  await waitFor(() => f.errors.length === 1);
  assert.match(f.errors[0].err.message, /upstream terminated/);
  truncate = false;
  const retry = await f.fetch(f.url);
  assert.deepEqual(Buffer.from(await retry.arrayBuffer()), payload);
  assert.equal((await User.findById(f.user._id)).credit, 95);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 1);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 1);
});

test("Scene quota is charged once at creation, not for each range or retry", async (t) => {
  const f = await fixture(t, { assetType: "scene", paymentMethod: "free_quota" });
  assert.equal(f.created.quotaCost, 5);
  for (let i = 0; i < 2; i += 1) {
    const response = await f.fetch(f.url, { headers: { range: "bytes=0-99", "if-range": etag } });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload.subarray(0, 100));
  }
  const quota = await DailyDownloadQuota.findOne({ userId: f.user._id });
  assert.equal(quota.count, 5);
  assert.equal((await User.findById(f.user._id)).credit, 100);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 0);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 1);
});
