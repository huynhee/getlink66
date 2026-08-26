import test from "node:test";
import assert from "node:assert/strict";

process.env.CSRF_HMAC_SECRET = "request-security-test-secret-with-32-characters";

const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { requestGuard } = await import("../src/middleware/requestGuard.js");

function response() {
  return {
    cookies: {},
    statusCode: 200,
    payload: null,
    cookie(name, value) {
      this.cookies[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("CSRF middleware rejects a missing token and accepts the issued token", () => {
  const issueResponse = response();
  issueCsrfToken({ cookies: {} }, issueResponse);
  const csrfSecret = issueResponse.cookies.csrfSecret;
  const csrfToken = issueResponse.payload.csrfToken;
  assert.ok(csrfSecret);
  assert.ok(csrfToken);

  const deniedResponse = response();
  let deniedNext = false;
  csrfProtection({
    method: "POST",
    path: "/api/admin/action",
    cookies: { csrfSecret },
    ip: "127.0.0.1",
    get() {
      return "";
    },
  }, deniedResponse, () => {
    deniedNext = true;
  });
  assert.equal(deniedNext, false);
  assert.equal(deniedResponse.statusCode, 403);

  const acceptedResponse = response();
  let acceptedNext = false;
  csrfProtection({
    method: "POST",
    path: "/api/admin/action",
    cookies: { csrfSecret },
    ip: "127.0.0.1",
    get(name) {
      return String(name).toLowerCase() === "x-csrf-token" ? csrfToken : "";
    },
  }, acceptedResponse, () => {
    acceptedNext = true;
  });
  assert.equal(acceptedNext, true);
});

test("CSRF middleware delegates upload-tool sync routes to token auth", () => {
  const path = "/api/admin/marketplace/drive/sync-folder";
  const deniedResponse = response();
  let deniedNext = false;
  csrfProtection({
    method: "POST",
    path,
    cookies: {},
    ip: "127.0.0.1",
    get() {
      return "";
    },
  }, deniedResponse, () => {
    deniedNext = true;
  });
  assert.equal(deniedNext, false);
  assert.equal(deniedResponse.statusCode, 403);

  for (const [name, value] of [
    ["x-marketplace-upload-token", "upload-tool-token"],
    ["authorization", "Bearer upload-tool-token"],
  ]) {
    const acceptedResponse = response();
    let acceptedNext = false;
    csrfProtection({
      method: "POST",
      path,
      cookies: {},
      ip: "127.0.0.1",
      get(headerName) {
        return String(headerName).toLowerCase() === name ? value : "";
      },
    }, acceptedResponse, () => {
      acceptedNext = true;
    });
    assert.equal(acceptedNext, true);
    assert.equal(acceptedResponse.statusCode, 200);
  }
});

test("request guard blocks Mongo operators and dotted keys", () => {
  for (const body of [
    { $where: "return true" },
    { profile: { "role.admin": true } },
    { nested: { constructor: { prototype: { admin: true } } } },
  ]) {
    const res = response();
    let nextCalled = false;
    requestGuard({
      body,
      query: {},
      ip: "127.0.0.1",
      path: "/api/test",
    }, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
  }
});

test("request guard allows ordinary nested payloads", () => {
  const res = response();
  let nextCalled = false;
  requestGuard({
    body: { profile: { name: "QA", filters: ["modern", "corona"] } },
    query: { page: "1" },
    ip: "127.0.0.1",
    path: "/api/test",
  }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
