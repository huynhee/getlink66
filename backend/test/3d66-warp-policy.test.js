import test from "node:test";
import assert from "node:assert/strict";
import {
  get3D66ProxyConfiguration,
  is3D66WarpHealthReady,
  parseCloudflareTrace,
  resolve3D66ProxyRoute,
  shouldFallback3D66ProxyFailure,
} from "../src/utils/3d66ProxyPolicy.js";

const ENV_KEYS = [
  "THREED66_PROXY_ENABLED",
  "THREED66_PROXY_MODE",
  "THREED66_PROXY_URL",
  "THREED66_PROXY_FOR_API",
  "THREED66_PROXY_FOR_DOWNLOAD",
  "THREED66_PROXY_FAIL_CLOSED",
  "THREED66_WARP_REQUIRE_HKG_FOR_ACCOUNT",
  "THREED66_WARP_FILE_FALLBACK_DIRECT",
];

async function withProxyEnv(values, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    Object.entries(values).forEach(([key, value]) => {
      process.env[key] = String(value);
    });
    return await callback();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test("parses Cloudflare trace and only accepts WARP through HKG", () => {
  const hkg = parseCloudflareTrace("fl=1\nwarp=on\ncolo=HKG\nip=203.0.113.1\n");
  const sin = parseCloudflareTrace("warp=on\ncolo=SIN\n");

  assert.equal(hkg.warp, "on");
  assert.equal(hkg.colo, "HKG");
  assert.equal(is3D66WarpHealthReady({ listener: true, ...hkg }), true);
  assert.equal(is3D66WarpHealthReady({ listener: true, ...sin }), false);
  assert.equal(is3D66WarpHealthReady({ listener: false, ...hkg }), false);
});

test("generic proxy routing remains compatible and only targets 3D66 hosts", async () => {
  await withProxyEnv({
    THREED66_PROXY_ENABLED: true,
    THREED66_PROXY_MODE: "generic",
    THREED66_PROXY_URL: "http://proxy.example:3128",
    THREED66_PROXY_FOR_API: true,
  }, async () => {
    const allowed = await resolve3D66ProxyRoute("api", "https://user.3d66.com/api/v1/download/handle");
    const blocked = await resolve3D66ProxyRoute("api", "https://example.com/file.zip");

    assert.equal(allowed.useProxy, true);
    assert.equal(allowed.mode, "generic");
    assert.equal(blocked.useProxy, false);
  });
});

test("WARP account traffic fails closed while file pulls may fall back direct", async () => {
  await withProxyEnv({
    THREED66_PROXY_MODE: "warp",
    THREED66_WARP_REQUIRE_HKG_FOR_ACCOUNT: true,
    THREED66_WARP_FILE_FALLBACK_DIRECT: true,
  }, async () => {
    assert.equal(shouldFallback3D66ProxyFailure("api"), false);
    assert.equal(shouldFallback3D66ProxyFailure("browser"), false);
    assert.equal(shouldFallback3D66ProxyFailure("file"), true);
  });
});

test("enabled WARP with no listener blocks account API but lets file pull fall back", async () => {
  await withProxyEnv({
    THREED66_PROXY_ENABLED: true,
    THREED66_PROXY_MODE: "warp",
    THREED66_PROXY_FOR_API: true,
    THREED66_PROXY_FOR_DOWNLOAD: true,
    THREED66_WARP_REQUIRE_HKG_FOR_ACCOUNT: true,
    THREED66_WARP_FILE_FALLBACK_DIRECT: true,
  }, async () => {
    await assert.rejects(
      resolve3D66ProxyRoute("api", "https://user.3d66.com/api/v1/download/handle"),
      (error) => error.status === 503 && error.code === "THREED66_WARP_UNAVAILABLE",
    );
    const fileRoute = await resolve3D66ProxyRoute(
      "file",
      "https://download.3d66.com/example.zip",
    );
    assert.equal(fileRoute.useProxy, false);
    assert.equal(fileRoute.fallback, true);
  });
});

test("admin-safe proxy configuration never includes the proxy URL", async () => {
  await withProxyEnv({
    THREED66_PROXY_ENABLED: true,
    THREED66_PROXY_MODE: "warp",
    THREED66_PROXY_URL: "http://user:secret@127.0.0.1:40000",
    THREED66_PROXY_FOR_API: true,
  }, async () => {
    const config = get3D66ProxyConfiguration();
    assert.equal(config.configured, true);
    assert.equal(config.mode, "warp");
    assert.equal(Object.hasOwn(config, "proxyUrl"), false);
    assert.equal(JSON.stringify(config).includes("secret"), false);
  });
});
