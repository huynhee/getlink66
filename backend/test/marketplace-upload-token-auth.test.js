import test from "node:test";
import assert from "node:assert/strict";

import { marketplaceUploadTokenAuth } from "../src/middleware/marketplaceUploadTokenAuth.js";

function request(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    get(name) {
      return normalized[String(name).toLowerCase()] || "";
    },
  };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
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

test("marketplace upload token accepts the dedicated Bearer token", () => {
  const previous = process.env.MARKETPLACE_UPLOAD_API_TOKEN;
  process.env.MARKETPLACE_UPLOAD_API_TOKEN = "upload-tool-test-token";
  try {
    const req = request({ authorization: "Bearer upload-tool-test-token" });
    const res = response();
    let nextValue = "not-called";
    marketplaceUploadTokenAuth(req, res, (value) => {
      nextValue = value;
    });

    assert.equal(nextValue, undefined);
    assert.equal(req.marketplaceUploadTool, true);
    assert.equal(req.user.role, "service");
  } finally {
    if (previous === undefined) delete process.env.MARKETPLACE_UPLOAD_API_TOKEN;
    else process.env.MARKETPLACE_UPLOAD_API_TOKEN = previous;
  }
});

test("marketplace upload token rejects an invalid token", () => {
  const previous = process.env.MARKETPLACE_UPLOAD_API_TOKEN;
  process.env.MARKETPLACE_UPLOAD_API_TOKEN = "upload-tool-test-token";
  try {
    const req = request({ "x-marketplace-upload-token": "wrong-token" });
    const res = response();
    let nextCalled = false;
    marketplaceUploadTokenAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.code, "MARKETPLACE_UPLOAD_TOKEN_INVALID");
  } finally {
    if (previous === undefined) delete process.env.MARKETPLACE_UPLOAD_API_TOKEN;
    else process.env.MARKETPLACE_UPLOAD_API_TOKEN = previous;
  }
});

test("missing upload token falls through to the existing admin route", () => {
  const req = request();
  const res = response();
  let nextValue = "not-called";
  marketplaceUploadTokenAuth(req, res, (value) => {
    nextValue = value;
  });

  assert.equal(nextValue, "route");
  assert.equal(res.statusCode, 200);
});
