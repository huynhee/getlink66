import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { paypalApi } from "../src/utils/paypal.js";

const originalFetch = globalThis.fetch;
const keys = ["PAYPAL_ENABLED", "PAYPAL_ENV", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_MERCHANT_ID", "CLIENT_URL"];
let savedEnvironment;
let sequence = 0;

beforeEach(() => {
  savedEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    PAYPAL_ENABLED: "false", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: `diagnostic-client-${++sequence}`,
    PAYPAL_CLIENT_SECRET: "private-diagnostic-fixture", PAYPAL_WEBHOOK_ID: "WEBHOOK1", PAYPAL_MERCHANT_ID: "MERCHANT1",
    CLIENT_URL: "https://example.test",
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
});

function mockApi(reply) {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api-m.sandbox.paypal.com");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new URL(url).pathname === "/v1/oauth2/token"
      ? Response.json({ access_token: "private-token-fixture", expires_in: 0 })
      : reply();
  };
}

test("OAuth errors retain invalid_client and the real HTTP status without leaking secrets", async () => {
  globalThis.fetch = async () => Response.json({ error: "invalid_client", error_description: "private-diagnostic-fixture" }, { status: 401 });
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), (error) => {
    assert.equal(error.code, "PAYPAL_API_ERROR");
    assert.equal(error.paypalStage, "oauth");
    assert.equal(error.paypalStatus, 401);
    assert.equal(error.paypalIssue, "invalid_client");
    assert.match(error.message, /oauth.*HTTP 401.*invalid_client/);
    assert.ok(!JSON.stringify(error).includes("private-diagnostic-fixture"));
    assert.ok(!error.message.includes("private-diagnostic-fixture"));
    return true;
  });
});

test("API errors retain issue and safe PayPal debug ID without forwarding raw details", async () => {
  mockApi(() => Response.json({
    name: "UNPROCESSABLE_ENTITY", debug_id: "debug-123", message: "private-token-fixture",
    details: [{ issue: "PAYEE_ACCOUNT_INVALID", description: "private-diagnostic-fixture" }],
  }, { status: 422 }));
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), (error) => {
    assert.equal(error.paypalStage, "api");
    assert.equal(error.paypalStatus, 422);
    assert.equal(error.paypalIssue, "PAYEE_ACCOUNT_INVALID");
    assert.equal(error.paypalDebugId, "debug-123");
    assert.ok(!JSON.stringify(error).includes("private-"));
    assert.ok(!error.message.includes("private-"));
    return true;
  });
});

test("HTML HTTP failures report status instead of pretending to be a timeout", async () => {
  mockApi(() => new Response("<html>private-diagnostic-fixture</html>", { status: 502 }));
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), {
    code: "PAYPAL_API_ERROR", paypalStage: "api", paypalStatus: 502, paypalIssue: "API_ERROR",
  });
});

test("upstream diagnostics reject URLs and arbitrary error text", async () => {
  mockApi(() => Response.json({ name: "https://example.test/private-token-fixture", debug_id: "unsafe text" }, { status: 403 }));
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), { paypalIssue: "API_ERROR", paypalDebugId: "" });
});

test("OAuth timeouts are classified without automatic retry", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new DOMException("private-diagnostic-fixture", "TimeoutError"); };
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), {
    code: "PAYPAL_API_TIMEOUT", status: 504, paypalStage: "oauth", paypalIssue: "TIMEOUT",
  });
  assert.equal(calls, 1);
});

test("response body timeouts do not turn into successful empty PayPal responses", async () => {
  mockApi(() => ({ status: 200, ok: true, json: async () => { throw new DOMException("private-token-fixture", "TimeoutError"); } }));
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), { code: "PAYPAL_API_TIMEOUT", paypalStage: "api" });
});

test("network failures expose a safe cause code but no Authorization, URL or raw cause", async () => {
  mockApi(() => { throw Object.assign(new TypeError("private-token-fixture"), { cause: { code: "ECONNRESET", authorization: "private-token-fixture" } }); });
  await assert.rejects(paypalApi("/v1/notifications/webhooks/WEBHOOK1"), (error) => {
    assert.equal(error.code, "PAYPAL_CONNECTION_FAILED");
    assert.equal(error.paypalStage, "api");
    assert.equal(error.paypalIssue, "ECONNRESET");
    assert.ok(!JSON.stringify(error).includes("private-token-fixture"));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("read-only CLI verifies OAuth and webhook with payments disabled and no secret output", () => {
  const scriptUrl = new URL("../scripts/paypal-check.js", import.meta.url).href;
  const source = `
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      if (options.method === "POST" && path === "/v1/oauth2/token") return Response.json({ access_token: "private-token-fixture", expires_in: 0 });
      if ((!options.method || options.method === "GET") && path === "/v1/notifications/webhooks/WEBHOOK1") return Response.json({ url: "https://example.test/api/payments/paypal/webhook", event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }] });
      throw new Error("No payment mutation is allowed");
    };
    await import(${JSON.stringify(scriptUrl)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, DOTENV_CONFIG_PATH: new URL("fixtures/no-paypal-env", import.meta.url).pathname }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /enabled: false/);
  assert.match(result.stdout, /PayPal connection: OK/);
  assert.match(result.stdout, /expectedUrlMatches: true/);
  assert.ok(!result.stdout.includes("private-"));
  assert.equal(result.stderr, "");
});
