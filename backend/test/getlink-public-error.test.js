import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { getlinkPublicErrors } from "../src/middleware/getlinkPublicErrors.js";
import { publicGetlinkError, publicGetlinkJobError } from "../src/utils/getlinkPublicError.js";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { adminOnly } from "../src/middleware/adminOnly.js";

useMemoryDb();
const { publicGetlinkJob } = await import("../src/utils/getlinkJobService.js");

const privateFailure = {
  message: "3D66 requires administrator verification in Chromium. Cookie login_token, sof and signed link are pending.",
  code: "THREED66_REWRITTEN_FOOTPRINT_FAILED", status: 403, retryable: false,
  details: { stage: "rewritten-footprint", reason: "upstream_verification_required" },
  verificationUrl: "https://private.example.test/session",
};

for (const language of ["vi", "en"]) {
  test(`technical Getlink failures become neutral messages in ${language}`, () => {
    for (const failure of [privateFailure,
      { message: "Storage profile failed", status: 503 },
      { message: "3D requires browser verification before a signed model link can be obtained.", status: 403 },
      { message: "Internal server error", status: 502 },
      { message: "Phiên trình duyệt cần quản trị viên xác minh.", status: 403 },
      { message: "Cookie decryption failed", code: "THREED66_PROFILE_INVALID", status: 422 },
    ]) {
      const publicError = publicGetlinkError(failure, language);
      assert.equal(publicError.code, "GETLINK_UNAVAILABLE");
      assert.equal(/captcha|cookie|browser|admin|sign|sof|profile|3d66|private|footprint/i.test(JSON.stringify(publicError)), false);
      assert.equal(publicError.message.startsWith(language === "vi" ? "Tạm thời" : "This model"), true);
    }
  });
}

test("user-actionable format, input and removed-model errors retain a safe distinction", () => {
  for (const [code, expected] of [
    ["THREED66_FORMAT_UNAVAILABLE", "GETLINK_FORMAT_UNAVAILABLE"],
    ["THREED66_HYBRID_INPUT_INVALID", "GETLINK_INVALID_INPUT"],
    ["THREED66_MODEL_REMOVED", "GETLINK_MODEL_UNAVAILABLE"],
  ]) assert.equal(publicGetlinkError({ code, message: privateFailure.message, status: 422 }).code, expected);
});

test("business errors are not replaced by source-operation diagnostics", () => {
  for (const failure of [
    { message: "Không đủ credit. Cần 28 credit.", status: 402 },
    { message: "Getlink price changed. Check the price and confirm again.", code: "GETLINK_PRICE_CHANGED", status: 409 },
    { message: "Another getlink request is already processing.", code: "GETLINK_JOB_ACTIVE", status: 409 },
    { message: "Too many requests. Try again later.", status: 429 },
    { message: "Invalid CSRF token", status: 403 },
    { message: "Please log in", status: 401 },
  ]) assert.equal(publicGetlinkError(failure), null);
});

test("job serialization strips technical fields from old jobs without mutating stored diagnostics", async () => {
  const snapshot = structuredClone(privateFailure);
  const req = { user: { _id: "fixture-user" }, get: name => name === "accept-language" ? "vi-VN" : "" };
  const body = await publicGetlinkJob(req, { _id: "fixture-job", status: "failed", error: privateFailure });
  assert.equal(body.error.code, "GETLINK_UNAVAILABLE");
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "retryable", "status"]);
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.status, 403);
  assert.deepEqual(privateFailure, snapshot);
  assert.equal(publicGetlinkJobError(null, req), null);
});

test("Getlink response protection covers direct errors and plugin routes, but preserves private diagnostics", async t => {
  const app = express();
  app.use(getlinkPublicErrors);
  const payload = { ...privateFailure, correlationId: "public-error-fixture" };
  for (const path of ["/api/getlink/preview", "/api/plugin/getlink/preview", "/api/getlink/download/fixture"]) {
    app.get(path, (_req, res) => res.status(403).json(payload));
  }
  app.get("/api/admin/getlink/verification", (_req, res) => res.status(403).json(payload));
  app.get("/api/getlink/inspect", (_req, res) => {
    res.locals.getlinkDiagnostics = true;
    res.status(403).json(payload);
  });
  app.get("/api/getlink/credit", (_req, res) => res.status(402).json({ message: "Not enough credit. Need 28 credit.", creditRequired: 28 }));
  app.get("/api/getlink/preview-ready", (_req, res) => res.json({ title: "Model", preparationStatus: "ready", creditCost: 28 }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/api/getlink/preview", "/api/plugin/getlink/preview", "/api/getlink/download/fixture"]) {
    const response = await fetch(base + path, { headers: { "accept-language": "vi-VN", "x-getlink-diagnostics": "true" } });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "GETLINK_UNAVAILABLE");
    assert.equal(body.message.startsWith("Tạm thời"), true);
    assert.deepEqual(Object.keys(body).sort(), ["code", "correlationId", "message", "retryable"]);
  }
  for (const path of ["/api/admin/getlink/verification", "/api/getlink/inspect"]) {
    assert.deepEqual(await fetch(base + path).then(r => r.json()), payload);
  }
  assert.deepEqual(await fetch(base + "/api/getlink/credit").then(r => r.json()), {
    message: "Not enough credit. Need 28 credit.", creditRequired: 28,
  });
  assert.equal((await fetch(base + "/api/getlink/preview-ready").then(r => r.json())).preparationStatus, "ready");
});

test("private inspect diagnostics require the existing admin and 2FA gates", async t => {
  const previous = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, ADMIN_2FA_REQUIRED: process.env.ADMIN_2FA_REQUIRED };
  Object.assign(process.env, { ADMIN_EMAILS: "admin@example.test", ADMIN_2FA_REQUIRED: "true" });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { default: router } = await import("../src/routes/getlinkRoutes.js");
  const inspect = router.stack.find(layer => layer.route?.path === "/getlink/inspect").route.stack;
  const gate = inspect.findIndex(layer => layer.handle === adminOnly);
  assert.ok(gate >= 0);
  const diagnostics = inspect[gate + 1].handle;
  for (const [role, verified, allowed] of [["user", true, false], ["admin", false, false], ["admin", true, true]]) {
    const req = { user: { role, email: "admin@example.test", isTwoFactorEnabled: true },
      jwtPayload: { is2FAVerified: verified }, path: "/getlink/inspect", get: () => "en" };
    const res = { locals: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    adminOnly(req, res, () => diagnostics(req, res, () => {}));
    assert.equal(res.locals.getlinkDiagnostics === true, allowed);
    if (!allowed) assert.equal(res.statusCode, 403);
  }
});
