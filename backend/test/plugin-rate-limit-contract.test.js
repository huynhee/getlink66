import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimit } from "../src/middleware/rateLimit.js";

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("plugin rate limit returns structured code, details and Retry-After", () => {
  const middleware = createRateLimit({
    keyPrefix: "plugin-contract-test",
    windowMs: 60_000,
    max: 1,
    keyGenerator: () => "device-1",
  });
  const req = { ip: "127.0.0.1", path: "/api/plugin/me", originalUrl: "/api/plugin/me" };
  middleware(req, responseRecorder(), () => {});
  const blocked = responseRecorder();
  middleware(req, blocked, () => assert.fail("rate-limited request must not continue"));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");
  assert.equal(blocked.body.details.retryAfter, Number(blocked.headers["retry-after"]));
  assert.ok(blocked.body.details.retryAfter >= 1);
});
