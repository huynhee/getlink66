import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceTurnstileConfig,
  verifyMarketplaceTurnstile,
} from "../src/utils/turnstile.js";

const ENV_KEYS = [
  "TURNSTILE_ENABLED",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_ACTION",
  "TURNSTILE_EXPECTED_HOSTNAME",
];

function preserveEnvironment() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

test("Turnstile stays disabled until both public and secret keys exist", () => {
  const original = preserveEnvironment();
  try {
    process.env.TURNSTILE_ENABLED = "true";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    delete process.env.TURNSTILE_SECRET_KEY;
    assert.deepEqual(marketplaceTurnstileConfig(), {
      enabled: false,
      provider: "none",
      siteKey: "",
      action: "",
    });
  } finally {
    restoreEnvironment(original);
  }
});

test("Turnstile validates a download token on the server", async () => {
  const original = preserveEnvironment();
  const originalFetch = global.fetch;
  try {
    process.env.TURNSTILE_ENABLED = "true";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    process.env.TURNSTILE_EXPECTED_ACTION = "marketplace_download";
    process.env.TURNSTILE_EXPECTED_HOSTNAME = "3dipl.org";
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.response, "valid-token");
      assert.equal(body.remoteip, "127.0.0.1");
      return new Response(JSON.stringify({
        success: true,
        hostname: "3dipl.org",
        action: "marketplace_download",
        cdata: "asset-123",
        challenge_ts: "2026-07-14T00:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await verifyMarketplaceTurnstile({
      token: "valid-token",
      remoteIp: "127.0.0.1",
      expectedCData: "asset-123",
    });
    assert.equal(result.success, true);
    assert.equal(result.action, "marketplace_download");
    assert.equal(result.cData, "asset-123");
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(original);
  }
});

test("Turnstile rejects missing and mismatched download verification", async () => {
  const original = preserveEnvironment();
  const originalFetch = global.fetch;
  try {
    process.env.TURNSTILE_ENABLED = "true";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    process.env.TURNSTILE_EXPECTED_ACTION = "marketplace_download";
    delete process.env.TURNSTILE_EXPECTED_HOSTNAME;

    await assert.rejects(
      verifyMarketplaceTurnstile({ token: "" }),
      (error) => error.code === "TURNSTILE_REQUIRED" && error.status === 400,
    );

    global.fetch = async () => new Response(JSON.stringify({
      success: true,
      hostname: "localhost",
      action: "login",
    }), { status: 200, headers: { "content-type": "application/json" } });

    await assert.rejects(
      verifyMarketplaceTurnstile({ token: "wrong-action" }),
      (error) => error.code === "TURNSTILE_ACTION_MISMATCH" && error.status === 400,
    );

    global.fetch = async () => new Response(JSON.stringify({
      success: true,
      hostname: "localhost",
      action: "marketplace_download",
      cdata: "asset-a",
    }), { status: 200, headers: { "content-type": "application/json" } });

    await assert.rejects(
      verifyMarketplaceTurnstile({ token: "wrong-asset", expectedCData: "asset-b" }),
      (error) => error.code === "TURNSTILE_CDATA_MISMATCH" && error.status === 400,
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(original);
  }
});
