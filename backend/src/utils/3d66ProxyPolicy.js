import { ProxyAgent } from "undici";

const WARP_TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const WARP_REQUIRED_COLO = "HKG";
const DEFAULT_WARP_HEALTH_TTL_MS = 30_000;
const DEFAULT_WARP_HEALTH_TIMEOUT_MS = 8_000;
const HEALTH_AGENT_CACHE_MAX = 3;
const PROXY_STAGE_ENV = {
  preview: "THREED66_PROXY_FOR_PREVIEW",
  api: "THREED66_PROXY_FOR_API",
  file: "THREED66_PROXY_FOR_DOWNLOAD",
  browser: "THREED66_PROXY_FOR_BROWSER",
};

const healthAgentCache = new Map();
let healthCache = null;
let healthCheckInFlight = null;

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === 1 || value === true;
}

function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function get3D66ProxyMode() {
  return String(process.env.THREED66_PROXY_MODE || "generic").trim().toLowerCase() === "warp"
    ? "warp"
    : "generic";
}

export function get3D66ProxyUrl() {
  return String(process.env.THREED66_PROXY_URL || "").trim();
}

export function mask3D66ProxyUrl(value = "") {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[invalid proxy url]";
  }
}

export function isAllowed3D66ProxyTarget(value = "") {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      (host === "3d66.com" || host.endsWith(".3d66.com"))
    );
  } catch {
    return false;
  }
}

function proxyStageEnabled(stage = "api") {
  const envName = PROXY_STAGE_ENV[stage];
  return envName ? booleanEnv(envName, false) : false;
}

function warpHealthTtlMs() {
  return integerEnv(
    "THREED66_WARP_HEALTH_TTL_MS",
    DEFAULT_WARP_HEALTH_TTL_MS,
    5_000,
    300_000,
  );
}

function healthAgent(proxyUrl) {
  if (!healthAgentCache.has(proxyUrl)) {
    while (healthAgentCache.size >= HEALTH_AGENT_CACHE_MAX) {
      const oldestKey = healthAgentCache.keys().next().value;
      if (!oldestKey) break;
      const oldestAgent = healthAgentCache.get(oldestKey);
      healthAgentCache.delete(oldestKey);
      Promise.resolve(oldestAgent?.close?.()).catch(() => {});
    }
    healthAgentCache.set(proxyUrl, new ProxyAgent(proxyUrl));
  }
  return healthAgentCache.get(proxyUrl);
}

export function parseCloudflareTrace(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .reduce((trace, line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) return trace;
      const key = line.slice(0, separator).trim().toLowerCase();
      const entryValue = line.slice(separator + 1).trim();
      if (key) trace[key] = entryValue;
      return trace;
    }, {});
}

export function is3D66WarpHealthReady(health = {}) {
  return Boolean(
    health.listener &&
    String(health.warp || "").toLowerCase() === "on" &&
    String(health.colo || "").toUpperCase() === WARP_REQUIRED_COLO,
  );
}

function safeHealthError(error, proxyUrl) {
  const raw = String(error?.message || error || "WARP health check failed");
  return proxyUrl ? raw.replaceAll(proxyUrl, mask3D66ProxyUrl(proxyUrl)).slice(0, 300) : raw.slice(0, 300);
}

function emptyWarpHealth({ proxyUrl, error = "" } = {}) {
  const checkedAt = new Date().toISOString();
  return {
    listener: false,
    warp: "off",
    colo: "",
    hkg: false,
    healthy: false,
    latencyMs: null,
    checkedAt,
    error: error || (proxyUrl ? "WARP local proxy is unreachable" : "Proxy URL is not configured"),
  };
}

async function performWarpHealthCheck(proxyUrl) {
  if (!proxyUrl) return emptyWarpHealth({ proxyUrl });

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_WARP_HEALTH_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await fetch(WARP_TRACE_URL, {
      dispatcher: healthAgent(proxyUrl),
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "text/plain",
        "user-agent": "3DIPL-WARP-Health/1.0",
      },
    });
    const body = await response.text();
    const trace = parseCloudflareTrace(body);
    const warp = String(trace.warp || "off").toLowerCase();
    const colo = String(trace.colo || "").toUpperCase();
    const hkg = colo === WARP_REQUIRED_COLO;
    const healthy = response.ok && is3D66WarpHealthReady({ listener: true, warp, colo });
    let error = "";
    if (!response.ok) error = `Cloudflare trace returned HTTP ${response.status}`;
    else if (warp !== "on") error = `Cloudflare trace reported warp=${warp || "off"}`;
    else if (!hkg) error = `Cloudflare WARP exit is ${colo || "unknown"}, expected ${WARP_REQUIRED_COLO}`;

    return {
      listener: true,
      warp,
      colo,
      hkg,
      healthy,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error,
    };
  } catch (error) {
    return {
      ...emptyWarpHealth({ proxyUrl, error: safeHealthError(error, proxyUrl) }),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function get3D66WarpHealth({ force = false } = {}) {
  const proxyUrl = get3D66ProxyUrl();
  const cacheKey = proxyUrl;
  const now = Date.now();

  if (
    !force &&
    healthCache?.key === cacheKey &&
    healthCache.expiresAt > now
  ) {
    return healthCache.value;
  }
  if (healthCheckInFlight?.key === cacheKey) return healthCheckInFlight.promise;

  const promise = performWarpHealthCheck(proxyUrl)
    .then((value) => {
      healthCache = {
        key: cacheKey,
        value,
        expiresAt: Date.now() + warpHealthTtlMs(),
      };
      return value;
    })
    .finally(() => {
      if (healthCheckInFlight?.promise === promise) healthCheckInFlight = null;
    });
  healthCheckInFlight = { key: cacheKey, promise };
  return promise;
}

export function clear3D66WarpHealthCache() {
  healthCache = null;
}

export function get3D66ProxyConfiguration() {
  return {
    enabled: booleanEnv("THREED66_PROXY_ENABLED", false),
    configured: Boolean(get3D66ProxyUrl()),
    mode: get3D66ProxyMode(),
    stages: {
      preview: proxyStageEnabled("preview"),
      api: proxyStageEnabled("api"),
      file: proxyStageEnabled("file"),
      browser: proxyStageEnabled("browser"),
    },
    requireHkgForAccount: booleanEnv("THREED66_WARP_REQUIRE_HKG_FOR_ACCOUNT", true),
    fileFallbackDirect: booleanEnv("THREED66_WARP_FILE_FALLBACK_DIRECT", true),
    healthTtlMs: warpHealthTtlMs(),
  };
}

function proxyPolicyError(stage, health) {
  const error = new Error(
    health?.error || "3D66 WARP is unavailable or is not using Hong Kong (HKG)",
  );
  error.status = 503;
  error.code = "THREED66_WARP_UNAVAILABLE";
  error.details = {
    stage,
    listener: Boolean(health?.listener),
    warp: health?.warp || "off",
    colo: health?.colo || "",
  };
  return error;
}

export function shouldFallback3D66ProxyFailure(stage = "api") {
  if (get3D66ProxyMode() !== "warp") {
    return !booleanEnv("THREED66_PROXY_FAIL_CLOSED", false);
  }
  if (stage === "file") {
    return booleanEnv("THREED66_WARP_FILE_FALLBACK_DIRECT", true);
  }
  return !booleanEnv("THREED66_WARP_REQUIRE_HKG_FOR_ACCOUNT", true);
}

export function create3D66ProxyConnectionError(stage = "api", cause = null) {
  const isWarp = get3D66ProxyMode() === "warp";
  const error = new Error(isWarp ? "3D66 WARP connection failed" : "3D66 proxy connection failed");
  error.status = isWarp ? 503 : 502;
  error.code = isWarp ? "THREED66_WARP_CONNECTION_FAILED" : "THREED66_PROXY_CONNECTION_FAILED";
  error.details = {
    stage,
    proxy: mask3D66ProxyUrl(get3D66ProxyUrl()),
    cause: String(cause?.message || cause || "Proxy request failed").slice(0, 300),
  };
  return error;
}

export async function resolve3D66ProxyRoute(stage, targetUrl) {
  const config = get3D66ProxyConfiguration();
  if (!config.enabled || !config.stages[stage]) {
    return { useProxy: false, fallback: false, mode: config.mode };
  }
  if (!isAllowed3D66ProxyTarget(targetUrl)) {
    return { useProxy: false, fallback: false, mode: config.mode };
  }
  if (config.mode !== "warp") {
    if (!config.configured) {
      return { useProxy: false, fallback: false, mode: config.mode };
    }
    return { useProxy: true, fallback: false, mode: config.mode, proxyUrl: get3D66ProxyUrl() };
  }

  const health = await get3D66WarpHealth();
  if (is3D66WarpHealthReady(health)) {
    return { useProxy: true, fallback: false, mode: config.mode, proxyUrl: get3D66ProxyUrl(), health };
  }

  const error = proxyPolicyError(stage, health);
  if (shouldFallback3D66ProxyFailure(stage)) {
    return { useProxy: false, fallback: true, mode: config.mode, error, health };
  }
  throw error;
}

export async function close3D66ProxyPolicy() {
  healthCache = null;
  healthCheckInFlight = null;
  const agents = [...healthAgentCache.values()];
  healthAgentCache.clear();
  await Promise.allSettled(agents.map((agent) => Promise.resolve(agent?.close?.())));
}
