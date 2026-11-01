import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: routes } = await import("../src/routes/adminRoutes.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { threed66VerificationService: service } = await import("../src/utils/3d66VerificationService.js");
const { default: AuditLog } = await import("../src/models/AuditLog.js");

test("manual verification HTTP routes require admin, 2FA, CSRF and rate limits without exposing session internals", async t => {
  const previous = Object.fromEntries(["ADMIN_EMAILS", "ADMIN_2FA_REQUIRED", "CSRF_HMAC_SECRET"].map(key => [key, process.env[key]]));
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.ADMIN_2FA_REQUIRED = "true";
  process.env.CSRF_HMAC_SECRET = "fixture-csrf-key-at-least-thirty-two-characters";
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let calls = 0;
  t.mock.method(service, "list", async () => { calls++; return { sessions: [] }; });
  for (const method of ["claim", "frame", "input", "reload", "complete", "release", "cancel"]) {
    t.mock.method(service, method, async () => { calls++; return { ok: true }; });
  }
  const app = express();
  app.use(express.json(), cookieParser(), (req, _res, next) => {
    const identity = req.get("x-test-identity");
    if (identity) req.user = { _id: identity, email: "admin@example.test", role: identity === "user" ? "user" : "admin",
      isTwoFactorEnabled: identity !== "unenrolled" };
    req.isAuthenticated = () => Boolean(req.user);
    req.jwtPayload = { is2FAVerified: identity !== "unverified" };
    next();
  });
  app.use(csrfProtection);
  app.get("/api/auth/csrf", issueCsrfToken);
  app.use("/api/admin", routes);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message, code: error.code }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const endpoint = "/api/admin/getlink/verifications";
  for (const [identity, status] of [["", 401], ["user", 403], ["unenrolled", 403], ["unverified", 403]]) {
    assert.equal((await fetch(origin + endpoint, { headers: { "x-test-identity": identity } })).status, status);
  }
  assert.equal(calls, 0);
  const csrf = await fetch(origin + "/api/auth/csrf");
  const headers = { "Content-Type": "application/json", cookie: csrf.headers.getSetCookie().at(-1).split(";")[0],
    "x-csrf-token": (await csrf.json()).csrfToken, "x-test-identity": "admin" };
  const listed = await fetch(origin + endpoint, { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "no-store, private");
  const actions = ["claim", "frame", "input", "reload", "complete", "release", "cancel"];
  for (const action of actions) {
    const path = `${endpoint}/fixture-session${action === "cancel" ? "" : "/" + action}`;
    const method = action === "cancel" ? "DELETE" : "POST";
    assert.equal((await fetch(origin + path, { method, headers: { ...headers, "x-csrf-token": "invalid" }, body: "{}" })).status, 403);
    assert.equal((await fetch(origin + path, { method, headers, body: JSON.stringify({ token: "private-fixture-token" }) })).status, 200);
  }
  await new Promise(resolve => setImmediate(resolve));
  for (const log of await AuditLog.find({ action: "COMPLETE_3D66_VERIFICATION" }).lean()) {
    assert.equal(log.details.token, "[REDACTED]");
  }
  t.mock.method(service, "frame", async () => { throw new Error("sensitive browser URL and cookie fixture"); });
  const failure = await fetch(origin + endpoint + "/fixture-session/frame", { method: "POST", headers, body: "{}" });
  assert.equal(failure.status, 503);
  assert.equal(JSON.stringify(await failure.json()).includes("sensitive browser"), false);
  const clock = Date.now() + 10000;
  t.mock.method(Date, "now", () => clock);
  for (let index = 0; index < 26; index++) {
    const response = await fetch(origin + endpoint + "/fixture-session/input", { method: "POST", headers, body: "{}" });
    if (index === 25) assert.equal(response.status, 429);
  }
});
