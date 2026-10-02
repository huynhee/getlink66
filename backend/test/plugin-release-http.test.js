import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";

process.env.NODE_ENV = "test";
process.env.ADMIN_EMAILS = "release-admin@example.test";
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.CSRF_HMAC_SECRET = "isolated-plugin-release-csrf-secret-32";
globalThis.__USE_MEMORY_DB__ = true;
const { default: router } = await import("../src/routes/adminRoutes.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { pluginReleaseService, CHUNK_BYTES } = await import("../src/services/pluginReleaseService.js");
const { default: AuditLog } = await import("../src/models/AuditLog.js");

test("real admin release routes enforce auth, 2FA, CSRF and bounded binary chunks", async (t) => {
  const original = { list: pluginReleaseService.list, chunk: pluginReleaseService.chunk, remove: pluginReleaseService.remove };
  let uploaded;
  pluginReleaseService.list = async () => ({ releases: [], channels: [] });
  pluginReleaseService.chunk = async (id, name, index, data) => {
    uploaded = { id, name, index, data };
    return { receivedChunks: [index] };
  };
  pluginReleaseService.remove = async () => {};
  t.after(() => Object.assign(pluginReleaseService, original));
  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => {
    // Trusted identities are injected only in this isolated HTTP fixture.
    const identity = req.get("x-test-identity");
    req.user = identity ? { _id: "000000000000000000000001", email: identity === "user" ? "user@example.test" : "release-admin@example.test",
      role: identity === "user" ? "user" : "admin", isTwoFactorEnabled: identity !== "no-2fa" } : null;
    req.isAuthenticated = () => Boolean(req.user);
    req.jwtPayload = { is2FAVerified: identity === "verified" };
    next();
  });
  app.get("/api/auth/csrf", issueCsrfToken);
  app.use(csrfProtection);
  app.use("/api/admin", router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [identity, status] of [["", 401], ["user", 403], ["no-2fa", 403], ["unverified", 403], ["verified", 200]]) {
    const response = await fetch(base + "/api/admin/plugin/releases", { headers: { "x-test-identity": identity } });
    assert.equal(response.status, status, identity);
    await response.text();
  }
  const csrf = await fetch(base + "/api/auth/csrf");
  const cookie = csrf.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await csrf.json();
  const url = base + "/api/admin/plugin/releases/000000000000000000000002/files/desktop.zip/chunks/0";
  const headers = { "x-test-identity": "verified", "content-type": "application/octet-stream", cookie };
  assert.equal((await fetch(url, { method: "PUT", headers, body: Buffer.alloc(10) })).status, 403);
  const allowed = await fetch(url, { method: "PUT", headers: { ...headers, "x-csrf-token": csrfToken }, body: Buffer.alloc(CHUNK_BYTES, 7) });
  assert.equal(allowed.status, 200);
  assert.equal(uploaded.data.length, CHUNK_BYTES);
  assert.ok(Buffer.isBuffer(uploaded.data));
  const tooLarge = await fetch(url, { method: "PUT", headers: { ...headers, "x-csrf-token": csrfToken }, body: Buffer.alloc(CHUNK_BYTES + 1) });
  assert.equal(tooLarge.status, 413);
  const deleted = await fetch(base + "/api/admin/plugin/releases/000000000000000000000002", {
    method: "DELETE", headers: { "x-test-identity": "verified", cookie, "x-csrf-token": csrfToken },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });
  const audit = await AuditLog.findOne({ action: "DELETE_PLUGIN_RELEASE_DRAFT" }).lean();
  assert.equal(audit.targetId, "000000000000000000000002");
  assert.equal(audit.actorEmail, "release-admin@example.test");
});
