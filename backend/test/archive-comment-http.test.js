import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { zipFixture } from "./fixtures/archiveFixture.js";

useMemoryDb();
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAILS = "trace-admin@example.test";
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.CSRF_HMAC_SECRET = "trace-csrf-isolated-fixture-secret-32";
process.env.ARCHIVE_TRACE_SECRET = "98".repeat(32);
process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "trace-drive-fixture-token";
process.env.DOWNLOAD_TOKEN_SECRET = "trace-download-fixture-secret-with-32";
process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "drive_redirect";
process.env.MARKETPLACE_ALLOW_PUBLIC_DRIVE_LINKS = "true";
process.env.LOG_LEVEL = "silent";

const { default: User } = await import("../src/models/User.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DownloadSession } = await import("../src/models/DownloadSession.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: CreditLedgerEntry } = await import("../src/models/CreditLedgerEntry.js");
const { default: AuditLog } = await import("../src/models/AuditLog.js");
const { default: adminRouter } = await import("../src/routes/adminRoutes.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { createMarketplaceDownloadSession } = await import("../src/utils/marketplaceDownloadService.js");
const { downloadSessionFile } = await import("../src/controllers/marketplaceController.js");
const { readArchiveTrace } = await import("../src/utils/archiveTrace.js");
const { getSettings } = await import("../src/controllers/settingsController.js");
const { invalidateMarketplacePricingCache } = await import("../src/utils/marketplacePricingService.js");
let sequence = 0;

async function fixture(t, { assetType = "model", archiveExt = "zip", paymentMethod = "credit", httpValidators = true, payload = zipFixture(Buffer.alloc(300000, 82)) } = {}) {
  sequence += 1;
  const user = await User.create({ email: `trace-${sequence}@example.test`, credit: 100 });
  await SiteSetting.findOneAndUpdate({ key: "homepage" }, { $set: { archiveCommentEnabled: true,
    archiveCommentText: "3dipl.org", marketplaceModelCreditPrice: 5, marketplaceSceneCreditPrice: 20 } }, { upsert: true });
  invalidateMarketplacePricingCache();
  const asset = await MarketplaceModel.create({ title: `Trace ${sequence}`, slug: `trace-${sequence}`, assetType,
    accessType: paymentMethod === "free_quota" ? "free" : "member", metadataStatus: "complete", fileStatus: "ready", isPublished: true,
    storageProvider: "google_drive", driveFileId: "trace-fixture-file", fileSize: payload.length, archiveExt,
    sha256: crypto.createHash("sha256").update(payload).digest("hex"), source: { provider: "google_drive" } });
  let upstreamError = false;
  let sourceEtag = '"original"';
  const metadata = { id: asset.driveFileId, size: String(payload.length), version: "10", trashed: false, capabilities: { canDownload: true } };
  const requests = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    if (String(input).startsWith("http://127.0.0.1:")) return realFetch(input, options);
    assert.equal(new URL(input).hostname, "www.googleapis.com");
    const url = new URL(input);
    assert.equal(options.method || "GET", "GET", "Marked downloads must not write Drive metadata");
    requests.push(options);
    if (upstreamError) return new Response("Fixture Drive failure", { status: 500 });
    if (url.searchParams.get("alt") !== "media") {
      assert.ok(url.searchParams.get("fields").includes("version"), "Only private source version metadata is needed");
      return Response.json(metadata);
    }
    const range = new Headers(options.headers).get("range");
    const match = /^bytes=(\d+)-(\d+)$/.exec(range || "");
    const start = match ? Number(match[1]) : 0;
    const end = match ? Number(match[2]) : payload.length - 1;
    return new Response(payload.subarray(start, end + 1), { status: match ? 206 : 200, headers: {
      "content-length": String(end - start + 1), ...(httpValidators ? { etag: sourceEtag } : {}),
      ...(match ? { "content-range": `bytes ${start}-${end}/${payload.length}` } : {}),
    } });
  });
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req, _res, next) => {
    const identity = req.get("x-test-identity");
    req.user = req.path.startsWith("/api/admin") ? (identity ? {
      _id: "000000000000000000000099", email: identity === "user" ? user.email : "trace-admin@example.test",
      role: identity === "user" ? "user" : "admin", isTwoFactorEnabled: identity !== "no-2fa",
    } : null) : user;
    req.isAuthenticated = () => Boolean(req.user);
    req.jwtPayload = { is2FAVerified: identity === "verified" };
    next();
  });
  app.get("/api/auth/csrf", issueCsrfToken);
  app.use(csrfProtection);
  app.use("/api/admin", adminRouter);
  app.get("/api/download/session/:id/file", downloadSessionFile);
  app.get("/api/plugin/download/session/:id/file", downloadSessionFile);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csrf = await realFetch(base + "/api/auth/csrf");
  const cookie = csrf.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await csrf.json();
  const headers = { cookie, "x-csrf-token": csrfToken, "content-type": "application/json", "x-test-identity": "verified" };
  const create = (requestId, clientType = "web") => createMarketplaceDownloadSession({ modelId: asset._id, clientType,
    req: { user, body: { paymentMethod, clientRequestId: requestId }, ip: "127.0.0.1",
      get: (name) => name === "idempotency-key" ? requestId : "trace-fixture" } });
  return { base, headers, create, user, asset, payload, requests, metadata, fetch: realFetch,
    fail: () => { upstreamError = true; }, change: () => { sourceEtag = '"changed"'; metadata.version = "11"; } };
}

for (const httpValidators of [true, false]) test(`marked web ranges, HEAD, retries and idempotency preserve one representation and one debit (HTTP validators: ${httpValidators})`, async (t) => {
  const f = await fixture(t, { assetType: "scene", httpValidators });
  const created = await f.create("trace-first-0001");
  const retryCreate = await f.create("trace-first-0001");
  assert.equal(created.session._id, retryCreate.session._id);
  const stored = await DownloadSession.findById(created.session._id);
  const trace = readArchiveTrace(stored.archiveComment);
  assert.equal(trace.userId, String(f.user._id));
  assert.equal(trace.assetType, "scene");
  assert.equal(created.session.sha256, "");
  assert.ok(created.session.fileSize > f.payload.length);
  assert.equal((await User.findById(f.user._id)).credit, 100);
  const url = f.base + created.downloadUrl;
  const head = await f.fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), created.session.fileSize);
  assert.equal((await User.findById(f.user._id)).credit, 100);
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => {
    const start = Math.floor(index * created.session.fileSize / 6);
    const end = Math.floor((index + 1) * created.session.fileSize / 6) - 1;
    return f.fetch(url, { headers: { range: `bytes=${start}-${end}`, "if-range": head.headers.get("etag") } });
  }));
  const chunks = await Promise.all(responses.map(async (response) => {
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
    return Buffer.from(await response.arrayBuffer());
  }));
  const full = await f.fetch(url);
  const output = Buffer.from(await full.arrayBuffer());
  assert.deepEqual(Buffer.concat(chunks), output);
  assert.ok(output.includes(Buffer.from(stored.archiveComment)));
  assert.equal(output.length, created.session.fileSize);
  assert.deepEqual(output.subarray(0, f.payload.length - 33), f.payload.subarray(0, f.payload.length - 33));
  assert.equal((await User.findById(f.user._id)).credit, 80);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 1);
  assert.equal((await MarketplaceModel.findById(f.asset._id)).downloadCount, 1);
  const other = await f.create("trace-second-0001");
  assert.notEqual(other.session.archiveComment, stored.archiveComment);
  assert.deepEqual(f.requests.every((request) => !request.method || request.method === "GET"), true);
});

test("admin settings are private, CSRF/2FA guarded, and source lookup is audited without exposing its secret", async (t) => {
  const f = await fixture(t);
  for (const [identity, status] of [["", 401], ["user", 403], ["no-2fa", 403], ["unverified", 403], ["verified", 200]]) {
    const response = await f.fetch(f.base + "/api/admin/archive-comments", { headers: { "x-test-identity": identity } });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(process.env.ARCHIVE_TRACE_SECRET));
  }
  const update = (body, headers = f.headers) => f.fetch(f.base + "/api/admin/archive-comments", { method: "PUT", headers, body: JSON.stringify(body) });
  assert.equal((await update({ enabled: true, text: "comment" }, { ...f.headers, "x-csrf-token": "wrong" })).status, 403);
  for (const text of ["a".repeat(4097), "bad\x1bcontrol", 123]) assert.equal((await update({ enabled: true, text })).status, 400);
  const created = await f.create("trace-lookup-001");
  const stored = await DownloadSession.findById(created.session._id);
  assert.equal((await update({ enabled: false, text: "new comment" })).status, 200);
  const old = await f.fetch(f.base + created.downloadUrl);
  assert.ok(Buffer.from(await old.arrayBuffer()).includes(Buffer.from(stored.archiveComment)));
  await DownloadSession.findByIdAndDelete(created.session._id);
  const lookup = await f.fetch(f.base + "/api/admin/archive-comments/lookup", { method: "POST", headers: f.headers, body: JSON.stringify({ token: stored.archiveComment }) });
  assert.equal(lookup.status, 200);
  const found = await lookup.json();
  assert.equal(found.user.email, f.user.email);
  assert.equal(found.trace.sessionId, String(created.session._id));
  assert.equal((await User.findById(f.user._id)).isBanned, undefined);
  const audit = await AuditLog.findOne({ action: "LOOKUP_ARCHIVE_TRACE" });
  assert.equal(audit.details.token, "[REDACTED]");
  let publicData;
  await getSettings({ user: null }, { json(value) { publicData = value; } }, (err) => { throw err; });
  assert.equal(Object.hasOwn(publicData.settings, "archiveCommentEnabled"), false);
  assert.equal(Object.hasOwn(publicData.settings, "archiveCommentText"), false);
});

test("unsafe archive/key/Drive failure rejects session before quota, Credit or download history is created", async (t) => {
  const f = await fixture(t, { paymentMethod: "free_quota", payload: Buffer.alloc(100, 82), archiveExt: "rar" });
  await assert.rejects(f.create("trace-invalid-rar"), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  f.fail();
  await assert.rejects(f.create("trace-drive-fail"), /Google Drive download failed/);
  const secret = process.env.ARCHIVE_TRACE_SECRET;
  delete process.env.ARCHIVE_TRACE_SECRET;
  try { await assert.rejects(f.create("trace-key-absent"), { code: "ARCHIVE_TRACE_KEY_REQUIRED" }); }
  finally { process.env.ARCHIVE_TRACE_SECRET = secret; }
  assert.equal(await DownloadSession.countDocuments({ userId: f.user._id }), 0);
  assert.equal(await ModelDownload.countDocuments({ userId: f.user._id }), 0);
  assert.equal(await DailyDownloadQuota.countDocuments({ userId: f.user._id }), 0);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 0);
});

for (const httpValidators of [true, false]) test(`changed source fails before credit billing without mixing archive bytes (HTTP validators: ${httpValidators})`, async (t) => {
  const f = await fixture(t, { httpValidators });
  const created = await f.create("trace-source-001");
  f.change();
  const response = await f.fetch(f.base + created.downloadUrl);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ARCHIVE_SOURCE_CHANGED");
  assert.equal((await User.findById(f.user._id)).credit, 100);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: f.user._id }), 0);
});

test("Drive version preflight failure does not create a session or consume Free quota", async (t) => {
  const f = await fixture(t, { httpValidators: false, paymentMethod: "free_quota" });
  f.metadata.version = "";
  await assert.rejects(f.create("trace-no-version-01"), { code: "ARCHIVE_SOURCE_CHANGED" });
  assert.equal(await DownloadSession.countDocuments({ userId: f.user._id }), 0);
  assert.equal(await ModelDownload.countDocuments({ userId: f.user._id }), 0);
  assert.equal(await DailyDownloadQuota.countDocuments({ userId: f.user._id }), 0);
  assert.equal((await User.findById(f.user._id)).credit, 100);
});

test("legacy plugins retain exact size, SHA-256 and original bytes when web tracing is enabled", async (t) => {
  const f = await fixture(t, { httpValidators: false });
  process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "proxy";
  t.after(() => { process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "drive_redirect"; });
  const created = await f.create("trace-plugin-001", "plugin");
  assert.equal(created.session.archiveComment || "", "");
  const response = await f.fetch(f.base + created.downloadUrl);
  const output = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(output, f.payload);
  assert.equal(output.length, created.session.fileSize);
  assert.equal(crypto.createHash("sha256").update(output).digest("hex"), created.session.sha256);
});
